"""Harbor adapter calling the packaged Foreman HTTP API."""
import asyncio
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import aiohttp
from aiohttp import web
from harbor.agents.base import BaseAgent
from harbor.models.agent.context import AgentContext

ROOT = Path(__file__).resolve().parents[2]
APP = Path(os.environ.get('FOREMAN_APP', ROOT / 'release/0.0.1/mac-arm64/Foreman.app/Contents/MacOS/Foreman'))
BRIDGE = Path(__file__).with_name('foreman_mcp_bridge.mjs')


class ForemanTerminalBench(BaseAgent):
    @staticmethod
    def name():
        return 'foreman'

    def version(self):
        return '0.0.1-http-api'

    async def setup(self, environment):
        if not APP.is_file():
            raise RuntimeError(f'Packaged Foreman is missing: {APP}')
        for name in ('FOREMAN_PROVIDER_ID', 'FOREMAN_PROVIDER_URL'):
            if not os.environ.get(name):
                raise RuntimeError(f'{name} must identify a provider configured in Foreman.')

    async def run(self, instruction, environment, context: AgentContext):
        started = time.monotonic()
        token = uuid4().hex
        jobs = {}
        process = None
        chat_id = 'terminal-bench-' + uuid4().hex
        workspace = tempfile.mkdtemp(prefix='foreman-task-')
        api_port = int(os.environ.get('FOREMAN_BENCH_API_PORT', '9336'))
        api_url = f'http://127.0.0.1:{api_port}'
        api_headers = {'Authorization': f'Bearer {token}'}
        requested_effort = os.environ.get('FOREMAN_BENCH_EFFORT', 'max')
        effort = 'xhigh' if requested_effort == 'max' else requested_effort
        if effort not in ('low', 'medium', 'high', 'xhigh'):
            raise RuntimeError(f'Unsupported FOREMAN_BENCH_EFFORT: {requested_effort}')

        async def execute(request):
            if request.headers.get('authorization') != f'Bearer {token}':
                raise web.HTTPUnauthorized()
            payload = await request.json()
            if payload['operation'] == 'start':
                job_id = uuid4().hex
                jobs[job_id] = asyncio.create_task(environment.exec(
                    payload['command'], cwd='/app', timeout_sec=int(payload.get('timeout_sec', 28800))))
                return web.json_response({'job_id': job_id, 'running': True})
            job_id = payload.get('job_id')
            job = jobs.get(job_id)
            if job is None:
                raise web.HTTPNotFound(text='Unknown command')
            if not job.done():
                return web.json_response({'job_id': job_id, 'running': True})
            result = await job
            del jobs[job_id]
            return web.json_response({'job_id': job_id, 'running': False, 'stdout': result.stdout,
                                      'stderr': result.stderr, 'return_code': result.return_code})

        bridge_app = web.Application()
        bridge_app.router.add_post('/exec', execute)
        runner = web.AppRunner(bridge_app)
        await runner.setup()
        site = web.TCPSite(runner, '127.0.0.1', 0)
        await site.start()
        bridge_port = site._server.sockets[0].getsockname()[1]
        logs = Path(self.logs_dir)
        logs.mkdir(parents=True, exist_ok=True)
        async with aiohttp.ClientSession(headers=api_headers, timeout=aiohttp.ClientTimeout(total=60)) as client:
            async def api(method, path, data=None):
                async with client.request(method, api_url + path, json=data) as response:
                    value = await response.json()
                    if response.status != 200:
                        raise RuntimeError(f'Foreman API {response.status}: {value}')
                    return value

            try:
                app_env = dict(os.environ, FOREMAN_API_PORT=str(api_port), FOREMAN_API_TOKEN=token)
                with (logs / 'foreman.log').open('wb') as output:
                    process = await asyncio.create_subprocess_exec(str(APP), env=app_env, stdout=output, stderr=output)
                for _ in range(60):
                    if process.returncode is not None:
                        raise RuntimeError('Foreman exited before API startup. See agent/foreman.log.')
                    try:
                        await api('GET', '/health')
                        break
                    except aiohttp.ClientConnectorError:
                        await asyncio.sleep(1)
                else:
                    raise RuntimeError('Foreman API startup timed out.')
                provider = {
                    'id': os.environ['FOREMAN_PROVIDER_ID'],
                    'name': 'Benchmark provider', 'preset': 'custom',
                    'baseUrl': os.environ['FOREMAN_PROVIDER_URL'],
                    'models': [self.model_name],
                }
                request = {
                    'chatId': chat_id, 'projectPath': workspace, 'workspaceMode': 'code',
                    'text': instruction + '\n\nUse mcp_tbenv_terminal_exec and mcp_tbenv_terminal_poll to work in the task container at /app. All task files and commands belong to this container.',
                    'mode': 'build', 'provider': provider, 'modelId': self.model_name,
                    'effort': effort, 'permissionMode': 'auto', 'contextWindow': 256000,
                }
                config = {'plugins': {'mcp': True}, 'permissionMode': 'auto', 'mcpServers': [{
                    'id': 'tbenv', 'name': 'Task container', 'enabled': True, 'transport': 'stdio',
                    'command': shutil.which('node'), 'args': [str(BRIDGE), str(bridge_port), token],
                }]}
                run = await api('POST', '/runs', {'request': request, 'options': {'config': config, 'mcpOnly': True}})
                manifest = {'model': self.model_name, 'effort': requested_effort, 'runtime_effort': effort,
                            'context_window': 256000,
                            'app': str(APP), 'tool_scope': 'mcp-only', 'benchmark': 'Terminal-Bench 4.1',
                            'adapter': str(Path(__file__).resolve()), 'run_id': run['runId']}
                (logs / 'foreman-config.json').write_text(json.dumps(manifest, indent=2))
                while True:
                    events = await api('GET', '/events?runId=' + run['runId'])
                    (logs / 'foreman-events.json').write_text(json.dumps(events, ensure_ascii=False, indent=2))
                    status = next((e for e in reversed(events) if e['type'] == 'status'), {})
                    if status.get('status') in ('done', 'error', 'stopped'):
                        summary = next((e['message'] for e in reversed(events)
                                        if e['type'] == 'message' and e['message'].get('runSummary')), {})
                        usage = summary.get('usage', {})
                        context.n_input_tokens = usage.get('input', 0) + usage.get('cacheRead', 0) + usage.get('cacheWrite', 0)
                        context.n_cache_tokens = usage.get('cacheRead', 0)
                        context.n_output_tokens = usage.get('output', 0)
                        context.metadata = dict(manifest, elapsed_seconds=time.monotonic() - started,
                                                foreman_status=status['status'], usage=usage)
                        if status['status'] != 'done':
                            raise RuntimeError(status.get('error') or 'Foreman stopped')
                        return
                    await asyncio.sleep(2)
            finally:
                if process and process.returncode is None:
                    try:
                        await api('POST', '/stop', {'chatId': chat_id})
                    except (aiohttp.ClientError, asyncio.TimeoutError, RuntimeError):
                        pass
                    finally:
                        process.terminate()
                        try:
                            await asyncio.wait_for(process.wait(), timeout=10)
                        except asyncio.TimeoutError:
                            process.kill()
                            await process.wait()
                for job in jobs.values():
                    job.cancel()
                await asyncio.gather(*jobs.values(), return_exceptions=True)
                await runner.cleanup()
                shutil.rmtree(workspace, ignore_errors=True)

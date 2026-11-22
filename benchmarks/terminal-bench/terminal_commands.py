"""Serve Harbor commands over the local benchmark bridge."""
import asyncio
from uuid import uuid4

from aiohttp import web


def command_handler(environment, jobs, token):
    async def execute(request):
        if request.headers.get('authorization') != f'Bearer {token}':
            raise web.HTTPUnauthorized()
        payload = await request.json()
        if payload['operation'] == 'start':
            job_id = uuid4().hex
            jobs[job_id] = asyncio.create_task(environment.exec(
                payload['command'], cwd='/app', timeout_sec=int(payload.get('timeout_sec', 28800))))
            wait_seconds = 1
        else:
            job_id = payload.get('job_id')
            wait_seconds = 5
        job = jobs.get(job_id)
        if job is None:
            raise web.HTTPNotFound(text='Unknown command')
        # Wait without cancelling a command that outlives the response window.
        done, _ = await asyncio.wait({job}, timeout=wait_seconds)
        if not done:
            return web.json_response({'job_id': job_id, 'running': True})
        jobs.pop(job_id, None)
        result = await job
        return web.json_response({'job_id': job_id, 'running': False, 'stdout': result.stdout,
                                  'stderr': result.stderr, 'return_code': result.return_code})

    return execute

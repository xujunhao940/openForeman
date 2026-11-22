"""Run the host Codex CLI against Harbor's isolated task environment."""
import asyncio
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from uuid import uuid4

from aiohttp import web
from terminal_commands import command_handler
from harbor.agents.base import BaseAgent
from harbor.models.agent.context import AgentContext

DEFAULT_CODEX = Path(
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/"
    "CodexCLI.app/Contents/MacOS/codex"
)
BRIDGE = Path(__file__).with_name("foreman_mcp_bridge.mjs")


class CodexTerminalBench(BaseAgent):
    @staticmethod
    def name():
        return "codex-host"

    def version(self):
        return "0.1.0-host-cli"

    async def setup(self, environment):
        codex = Path(os.environ.get("CODEX_CLI", DEFAULT_CODEX))
        if not codex.is_file():
            raise RuntimeError(f"Codex CLI is missing: {codex}")
        if not os.environ.get("CODEX_HOME"):
            raise RuntimeError("CODEX_HOME must point to the temporary benchmark profile.")
        if not shutil.which("node"):
            raise RuntimeError("node must be on PATH to start the task MCP bridge.")

    async def run(self, instruction, environment, context: AgentContext):
        started = time.monotonic()
        token = uuid4().hex
        jobs = {}
        workspace = tempfile.mkdtemp(prefix="codex-terminal-task-")
        logs = Path(self.logs_dir)
        logs.mkdir(parents=True, exist_ok=True)

        bridge_app = web.Application()
        bridge_app.router.add_post("/exec", command_handler(environment, jobs, token))
        runner = web.AppRunner(bridge_app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        bridge_port = site._server.sockets[0].getsockname()[1]

        try:
            codex = Path(os.environ.get("CODEX_CLI", DEFAULT_CODEX))
            server_args = [str(BRIDGE), str(bridge_port), token]
            server_config = (
                "{command=" + json.dumps(shutil.which("node")) + ",args=["
                + ",".join(json.dumps(value) for value in server_args)
                + "],startup_timeout_sec=30}"
            )
            base_url = os.environ.get(
                "CODEX_BENCH_BASE_URL", "http://127.0.0.1:18761/v1"
            )
            api_key_config = ',env_key="CODEX_BENCH_API_KEY"' if os.environ.get("CODEX_BENCH_API_KEY") else ""
            output_path = logs / "codex-last-message.txt"
            events_path = logs / "codex-events.jsonl"
            command = [
                str(codex), "exec", "--skip-git-repo-check", "--ephemeral",
                "--sandbox", "read-only", "--cd", workspace, "--model", self.model_name,
                "--json", "--output-last-message", str(output_path),
                "-c", 'model_provider="CUSTOM"',
                "-c", "model_providers.CUSTOM={name=\"CUSTOM\",base_url="
                + json.dumps(base_url)
                + ',wire_api="responses",requires_openai_auth=false' + api_key_config + "}",
                "-c", 'model_reasoning_effort="xhigh"',
                "-c", "model_context_window=256000",
                "-c", 'shell_environment_policy.exclude=["CODEX_BENCH_API_KEY"]',
                "-c", f"mcp_servers.tbenv={server_config}", "-",
            ]
            prompt = (
                instruction
                + "\n\nUse MCP tools from tbenv for all inspection, edits, and tests. "
                "They operate only in the isolated task container at /app."
            )
            with (logs / "codex.stderr.log").open("wb") as stderr_file:
                process = await asyncio.create_subprocess_exec(
                    *command, cwd=workspace, env=dict(os.environ),
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=stderr_file,
                )
                stdout, _ = await process.communicate(prompt.encode())
            events_path.write_bytes(stdout)
            if process.returncode != 0:
                raise RuntimeError(f"Codex exited with status {process.returncode}.")

            usage = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0}
            for line in stdout.decode(errors="replace").splitlines():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "turn.completed":
                    for key in usage:
                        usage[key] += int((event.get("usage") or {}).get(key, 0))

            context.n_input_tokens = usage["input_tokens"]
            context.n_cache_tokens = usage["cached_input_tokens"]
            context.n_output_tokens = usage["output_tokens"]
            context.metadata = {
                "provider": "CUSTOM",
                "model": self.model_name,
                "reasoning_effort": "xhigh",
                "elapsed_seconds": time.monotonic() - started,
                "usage": usage,
                "sandbox": "codex-read-only-host-with-isolated-task-mcp",
            }
        finally:
            for job in jobs.values():
                if not job.done():
                    job.cancel()
            await asyncio.gather(*jobs.values(), return_exceptions=True)
            await runner.cleanup()
            shutil.rmtree(workspace, ignore_errors=True)

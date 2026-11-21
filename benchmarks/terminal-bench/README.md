# Foreman Terminal-Bench integration

The packaged Foreman application exposes its actual agent runtime through an opt-in local HTTP API. Enable it using `FOREMAN_API_PORT` and `FOREMAN_API_TOKEN` when launching the executable. Every request requires `Authorization: Bearer <token>`.

| Method | Endpoint | Payload or result |
| --- | --- | --- |
| GET | `/health` | Application name and API version |
| POST | `/runs` | `{request, options}` returns `{runId}` |
| GET | `/events?runId=…` | Current run event snapshot, including status, tools and usage |
| POST | `/stop` | `{chatId}` stops the run |

`request` follows `RunRequest` in `shared/agent.ts`, including provider ID and URL, model, effort, project path and prompt. Foreman reads the API key from its encrypted credential store. `options.config` supplies per-run plugin and MCP settings. `options.mcpOnly` confines agent tools to the supplied MCP environment plus the planning tool. This mode disables host tools, memory, skills, checkpoints, review and subagents. All HTTP routes bind to loopback.

Start the packaged application with an API token of your choice.

```sh
export FOREMAN_API_PORT=9336
export FOREMAN_API_TOKEN="$(openssl rand -hex 32)"
./release/0.0.1/mac-arm64/Foreman.app/Contents/MacOS/Foreman
```

An external client can submit a normal Foreman run directly. Replace the saved provider ID, URL and workspace path with your configuration. Keep the API token in the client environment.

```sh
curl http://127.0.0.1:9336/runs \
  -H "Authorization: Bearer $FOREMAN_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"request":{"chatId":"api-example","projectPath":"/absolute/workspace","text":"Inspect this project and summarize its structure.","mode":"build","effort":"medium","modelId":"gpt-6.2-sol","provider":{"id":"saved-provider-id","name":"Configured provider","preset":"custom","baseUrl":"https://your-provider/v1","models":["gpt-6.2-sol"]}}}'

curl "http://127.0.0.1:9336/events?runId=RETURNED_RUN_ID" \
  -H "Authorization: Bearer $FOREMAN_API_TOKEN"
```

Harbor needs an adapter to call this API and connect the isolated task environment. `foreman_terminal_agent.py` performs that wiring. `foreman_mcp_bridge.mjs` exposes environment commands through MCP. The adapter starts the packaged application, creates a fresh scratch workspace and saves events, model usage and configuration in each trial's agent logs.

For the current comparison, both models use medium effort and a 256k context window. Each task runs serially. This measures Foreman with the MCP-only task environment configuration.

Install Harbor separately and configure `FOREMAN_PROVIDER_ID` and `FOREMAN_PROVIDER_URL` for your saved provider. Set `FOREMAN_APP` to override the packaged executable path. `node` must be on PATH and project npm dependencies must be installed.

From the Foreman source directory, run a task with the benchmark data and output directory of your choice.

```sh
PYTHONPATH="$PWD/benchmarks/terminal-bench" harbor run \
  -p /path/to/terminal-bench/task-name \
  -a foreman_terminal_agent:ForemanTerminalBench \
  -m gpt-6.1-terra -e apple-container --n-concurrent 1 \
  --jobs-dir /path/to/foreman_benchmark --job-name foreman-terra --yes
```

Use the same command and task set with `-m gpt-6.2-sol` for the second model. GPU-dependent tasks require a compatible environment. Benchmark datasets and trial outputs belong outside this source directory.

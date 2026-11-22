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
  -d '{"request":{"chatId":"api-example","projectPath":"/absolute/workspace","text":"Inspect this project and summarize its structure.","mode":"build","effort":"medium","modelId":"gpt-6.2-sol","provider":{"id":"saved-provider-id","name":"CUSTOM","preset":"custom","baseUrl":"https://your-provider/v1","models":["gpt-6.2-sol"]}}}'

curl "http://127.0.0.1:9336/events?runId=RETURNED_RUN_ID" \
  -H "Authorization: Bearer $FOREMAN_API_TOKEN"
```

Harbor needs an adapter to call this API and connect the isolated task environment. `foreman_terminal_agent.py` performs that wiring. `foreman_mcp_bridge.mjs` exposes environment commands through MCP. The adapter starts the packaged application, creates a fresh scratch workspace and saves events, model usage and configuration in each trial's agent logs.

The paired runs use the `CUSTOM` provider and the same base URL and API credential, with `gpt-6.2-sol (xhigh)`, a 256k context window, Apple Container, one trial at a time and identical task data. Foreman runs through its local HTTP compatibility API with `mcpOnly` to connect Harbor's isolated task environment. This disables Subagents and Foreman Mode. Both agents were rerun for this comparison.

### Paired retest results

| Task | Agent | Input tokens, including cache | Cached input, subset | Output tokens | Agent time | Test result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `fix-code-vulnerability` | Foreman | 147,318 | 51,707 | 2,695 | 91.55 s | 1.0 |
| `fix-code-vulnerability` | Codex CLI | 228,283 | 123,852 | 2,145 | 95.21 s | 1.0 |
| `regex-log` | Foreman | 55,667 | 3,196 | 4,014 | 110.45 s | Original task test passed |
| `regex-log` | Codex CLI | 119,566 | 67,920 | 3,891 | 108.86 s | Original task test passed |
| `polyglot-c-py` | Foreman | 121,021 | 25,234 | 4,091 | 144.65 s | Original task test passed |
| `polyglot-c-py` | Codex CLI | 425,128 | 247,202 | 6,652 | 227.03 s | 1.0 |
| `event-summary` | Foreman | 28,647 | 1,015 | 4,250 | 103.36 s | 1.0 |
| `event-summary` | Codex CLI | 122,989 | 58,463 | 6,100 | 160.26 s | 1.0 |
| `interval-index` | Foreman | 27,403 | 0 | 1,803 | 54.53 s | 1.0 |
| `interval-index` | Codex CLI | 114,776 | 73,601 | 2,972 | 109.14 s | 1.0 |
| `recurrence-expander` | Foreman | 49,040 | 4,207 | 7,693 | 180.82 s | 1.0 |
| `recurrence-expander` | Codex CLI | 251,726 | 172,581 | 11,523 | 288.85 s | 1.0 |

The charts show six tasks. `biped-contact-dynamics` is excluded because both agents hit the 720-second agent timeout, so it has no valid token totals and is not a useful paired runtime measurement. `regex-log` verifier execution timed out for both runs, and the `polyglot-c-py` Foreman verifier could not install its runner. Both `regex-log` outputs passed the original `tests/test_outputs.py` on the host. The Foreman `polyglot-c-py` output passed that original test on the host, and Codex received Harbor reward 1.0. The other four tasks received Harbor reward 1.0 for both agents.

Across the six charted tasks, Foreman used 453,642 tokens and 685.36 seconds. Codex used 1,295,751 tokens and 989.35 seconds. Foreman was faster on five tasks and slower on `regex-log` by 1.58 seconds. Both agents passed every charted task.

Total tokens are input plus output. Input tokens already include cached input, so the cached-input column is a subset and must not be added again. The Foreman adapter reports input plus cache-read and cache-write tokens. The Codex adapter reports the CLI's `input_tokens`, which includes cached tokens. The same base URL, credential, model and effort were configured, and both runtimes use the provider's Responses endpoint. Token values are the usage counters each runtime reported and are not independently reconciled against provider billing records. Agent time excludes verifier time. Harbor returned `cost_usd: null`, so dollar cost is unavailable.

Install Harbor separately and configure `FOREMAN_PROVIDER_ID` and `FOREMAN_PROVIDER_URL` for your saved provider. Set `FOREMAN_APP` to override the packaged executable path. `node` must be on PATH and project npm dependencies must be installed.

From the Foreman source directory, run a task with the benchmark data and output directory of your choice.

```sh
PYTHONPATH="$PWD/benchmarks/terminal-bench" FOREMAN_BENCH_EFFORT=xhigh harbor run \
  -p /path/to/terminal-bench/task-name \
  -a foreman_terminal_agent:ForemanTerminalBench \
  -m gpt-6.2-sol -e apple-container --n-concurrent 1 \
  --jobs-dir /path/to/foreman_benchmark --job-name foreman-gpt-6.2-sol-xhigh --yes
```

Set `FOREMAN_PROVIDER_ID` and `FOREMAN_PROVIDER_URL` in the environment before running. For Codex, use `codex_terminal_agent:CodexTerminalBench` and a temporary `CODEX_HOME`. Set `CODEX_BENCH_BASE_URL` to the same provider URL and supply the same key through `CODEX_BENCH_API_KEY`. Both adapters use the provider’s Responses endpoint. GPU-dependent tasks require a compatible environment. Benchmark datasets and trial outputs belong outside this source directory.

The local tasks award equal credit per passing case. Both agents passed all cases: 10/10 for `event-summary`, 10/10 for `interval-index`, and 13/13 for `recurrence-expander`.

The adapter waits up to one second for the initial command result and up to five seconds per poll. Token counts and elapsed times are taken from each run's agent result and usage metadata.

## Benchmark analysis

Across six paired tasks using the same `CUSTOM` provider base URL, API credential, and `gpt-6.2-sol (xhigh)` configuration, Foreman reported **453,642 tokens** and **685.36 seconds** of agent execution time. Codex CLI reported **1,295,751 tokens** and **989.35 seconds**. Both agents passed all six task tests.

### Why the reported token totals differ

Cached input accounted for 658,260 of the 842,109 tokens separating the two totals, or about **78% of the gap**. Input totals count tokens across model requests. When a new request includes earlier instructions, conversation history, or tool results, those tokens can be counted again even when the provider serves them from cache. After subtracting the reported cached input from each total, the comparison drops from **2.86× to 1.50×**, with 552,132 tokens for Codex CLI and 368,283 for Foreman. The adjusted figures still include output tokens. Codex CLI reported 33,283 output tokens and Foreman reported 24,546.

### Why elapsed time differs

The logs show 58 terminal commands and 16 polls for Codex CLI, compared with 30 commands and nine polls for Foreman. Each additional command or poll can add tool execution or waiting time and may require another model call. On `polyglot-c-py`, Codex CLI set up temporary toolchains and checked 159 reference values. Foreman checked 10 valid inputs and four invalid inputs. Both passed the original task test. On `regex-log`, both agents executed six terminal commands, and Codex CLI finished 1.58 seconds sooner despite reporting about twice as many tokens. Agent execution time excludes the benchmark verifier.

### What the comparison measures

Foreman and Codex CLI use the provider's Responses endpoint. The token totals come from each runtime's usage counters. Provider billing records and per-request timing were unavailable, so this run cannot isolate how much of the gap comes from context handling, endpoint accounting, model latency, or tool execution. The figures describe one paired run per task under this setup.

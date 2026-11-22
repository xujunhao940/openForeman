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

The paired runs use the `CUSTOM` provider with `gpt-6.2-sol` at `xhigh`, a 256k context window and one trial at a time. Foreman runs through its local HTTP compatibility API and uses `mcpOnly` to connect Harbor's isolated task environment. This disables Subagents and Foreman Mode. Foreman was retested after runtime optimizations. Codex retains its original paired-run data and was not rerun.

### Retest results

| Task | Agent and run | Input tokens, including cache | Cached input, subset | Output tokens | Agent time | Harbor reward or test result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `fix-code-vulnerability` | Foreman retest | 411,659 | 351,872 | 5,271 | 119.43 s | Harbor reward 1.0 |
| `fix-code-vulnerability` | Codex original | 353,375 | 310,016 | 4,059 | 126.83 s | Harbor reward 1.0 |
| `regex-log` | Foreman retest | 37,082 | 23,680 | 3,931 | 33.36 s | Original task test passed |
| `regex-log` | Codex original | 427,256 | 378,456 | 5,198 | 131.30 s | Original task test passed |

Across the two original paired tasks, Foreman used 457,943 total tokens and 152.79 seconds, compared with 789,888 tokens and 258.13 seconds for Codex. Total tokens are input plus output. The quality chart shows each task’s pass status, using the Harbor verifier for `fix-code-vulnerability` and the original task assertions for `regex-log`. Both agents passed those two tasks. On `fix-code-vulnerability` alone, Foreman used 416,930 total tokens and Codex used 357,434.

Input tokens already include cached input. Do not add the cached-input column to that value. The Foreman adapter reports `input + cacheRead + cacheWrite`, while the Codex adapter reports the CLI's `input_tokens`, which already includes cached tokens.

The `regex-log` Harbor verifier could not run pytest in either original run because pytest was unavailable after dependency setup failed. The verifier recorded reward 0.0 for Codex and timed out for the Foreman retest. Both saved regexes were recovered from their tool logs and passed the task's original `tests/test_outputs.py`. The test source was unchanged. Only the expected `/app/regex.txt` path was redirected to the recovered regex file for this direct test.

Harbor returned `cost_usd: null` for every run, so dollar cost is unavailable. Agent time excludes verifier time. The original comparison covers two tasks.

Install Harbor separately and configure `FOREMAN_PROVIDER_ID` and `FOREMAN_PROVIDER_URL` for your saved provider. Set `FOREMAN_APP` to override the packaged executable path. `node` must be on PATH and project npm dependencies must be installed.

From the Foreman source directory, run a task with the benchmark data and output directory of your choice.

```sh
PYTHONPATH="$PWD/benchmarks/terminal-bench" FOREMAN_BENCH_EFFORT=xhigh harbor run \
  -p /path/to/terminal-bench/task-name \
  -a foreman_terminal_agent:ForemanTerminalBench \
  -m gpt-6.2-sol -e apple-container --n-concurrent 1 \
  --jobs-dir /path/to/foreman_benchmark --job-name foreman-gpt-6.2-sol-xhigh --yes
```

Set `FOREMAN_PROVIDER_ID` and `FOREMAN_PROVIDER_URL` in the environment before running. For Codex, use `codex_terminal_agent:CodexTerminalBench` and a temporary `CODEX_HOME`. Set `CODEX_BENCH_BASE_URL` to the same provider URL and supply the same key through `CODEX_BENCH_API_KEY`. The Codex adapter uses the provider’s Responses endpoint. Foreman uses its Chat Completions endpoint. GPU-dependent tasks require a compatible environment. Benchmark datasets and trial outputs belong outside this source directory.

### Additional paired runs

The five additional tasks used the same CUSTOM provider URL and API credential for both agents, with `gpt-6.2-sol (xhigh)`, a 256k context window, Apple Container, and the same task instructions and verifiers. The Foreman recurrence result is from the earlier run with this credential. The remaining Foreman results and all five Codex results are from the new runs. The original two task pairs are historical measurements.

| Task | Agent | Input tokens, including cache | Cached input | Output tokens | Agent time | Test result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `polyglot-c-py` | Foreman | 134,739 | 105,088 | 10,554 | 148.44 s | Original task test passed on recovered file |
| `polyglot-c-py` | Codex CLI | 627,914 | 572,160 | 17,336 | 250.06 s | Original task test passed on recovered file |
| `event-summary` | Foreman | 45,944 | 33,664 | 14,666 | 140.55 s | 1.0 |
| `event-summary` | Codex CLI | 328,861 | 290,176 | 23,882 | 235.97 s | 1.0 |
| `interval-index` | Foreman | 37,525 | 23,680 | 5,271 | 42.19 s | 1.0 |
| `interval-index` | Codex CLI | 219,417 | 167,552 | 3,219 | 55.72 s | 1.0 |
| `recurrence-expander` | Foreman | 151,412 | 129,024 | 14,310 | 182.50 s | 1.0 |
| `recurrence-expander` | Codex CLI | 392,011 | 355,840 | 15,776 | 174.51 s | 1.0 |

The Foreman `polyglot-c-py` Harbor verifier could not download the test runner and recorded 0.0. Codex passed the Harbor verifier. Both recovered files also passed the same original task assertion in a separate run. The chart uses that paired assertion result.

The three local tasks award equal credit per passing case. Both agents passed all cases: 10/10 for `event-summary`, 10/10 for `interval-index`, and 13/13 for `recurrence-expander`.

### Tool calls

| Task | Foreman original commands / polls | Codex recorded commands / polls | Foreman retest commands / polls |
| --- | ---: | ---: | ---: |
| `fix-code-vulnerability` | 22 / 23 | 14 / 14 | 9 / 3 |
| `regex-log` | 7 / 7 | 5 / 5 | 3 / 0 |

The original adapters returned a job ID for every command. Retrieving even a short command's output required another tool call. The adapters now wait briefly for command completion before returning, which avoids many polling rounds.

The shared adapter waits up to one second for the initial result and up to five seconds per poll. Token counts and elapsed times in the retest table are from model runs. Tool calls above are counted from each run's event logs.

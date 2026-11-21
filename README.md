# Open Foreman

An Electron workspace for coding agents, built with React, shadcn/ui and AI Elements. The desktop agent runtime uses the official **pi coding agent SDK**; conversations and tool execution are real SDK sessions, not simulated replies.

## Run

Requires Node.js 22.19+ and Yarn 4.5.3.

```sh
yarn install
yarn dev
```

1. Add a project using an absolute directory path (or **Choose folder**).
2. Open **Settings → Providers**, add an OpenAI-compatible provider, save its API key and fetch models.
3. Enable a model in **Settings → Models**. Select it in the chat composer.
4. Choose **Build**, **Plan** or **Review**, then send a message. Approve requested actions in the conversation.

Providers currently use the OpenAI Chat Completions protocol, including custom base URLs and local keyless endpoints. API keys remain in Electron's system-encrypted credential store and are passed to pi through in-memory auth overrides. They are not sent through the agent IPC or written to pi auth files. Reasoning is off by default for compatibility; select a level only for models that support it. Context/output limits currently use conservative defaults of 128k/16k tokens rather than provider metadata.

The browser preview renders the UI and can preview plugin settings. File access and agents require Electron. Preview settings are separate from desktop runtime configuration.

## Bundled plugins

All ten capabilities ship as application code and remain part of the pi runtime. **Plugins** only lists global Skills and MCP servers. Set default permissions in **Settings → Permissions**, or override the current conversation inside the prompt input. Configuration changes take effect on the next run and are blocked while any run is active.

**Project details** opens from the project row in the sidebar and expands the animated project panel. It contains the project name, available models, memories, checkpoints and discovered skills. Project skills are enabled automatically. Add a global skill folder in **Plugins → Add global skill** to make it available across projects; global skills can be disabled or removed without deleting their source files. Reasoning effort uses a stepped slider alongside the model selector in one composer menu. The composer reports the active session context-window estimate (token usage when provided by the model, with a message-length fallback).

| Plugin | Behavior |
| --- | --- |
| Subagents | In all modes the main agent handles single tasks itself. Delegation requires at least two independent read-only assignments with different deliverables, launched in parallel. Foreman Mode scales the concurrency limit with reasoning effort. Children cannot delegate. |
| Plan mode | `update_plan` publishes ordered steps. Plan mode blocks file writes, shell commands, memory writes and MCP operations before execution. |
| Permissions | Ask, Approve for me, Read only and Allow all modes. Ask requires per-call approval for writes, shell, web and MCP. Approve for me uses the selected model to review actions and asks you if review does not approve. Approval expires after five minutes and is cancelled when the run stops. Disabling the plugin blocks sensitive tools. |
| Checkpoints | File snapshots before and after each run, persisted outside the project; unchanged snapshots are reused. Git repositories use tracked and non-ignored files; other folders exclude build and dependency directories. |
| Memory | Explicit per-project notes, editable in the UI and through a permission-gated `memory` tool; injected into subsequent sessions. |
| Web access | `web_fetch` retrieves public HTTP(S) text/HTML/JSON. DNS is checked and pinned, redirects are revalidated, with a 30-second timeout and 1 MiB response limit. It does not provide search-engine results or browser automation. |
| MCP | Tool discovery/calls over stdio and Streamable HTTP. Configure servers in Plugins; connections and calls require permission. Treated as mutating, so unavailable in Plan/Review and Read only. |
| Undo / redo | Restore file changes between checkpoints. All affected paths are checked for conflicts before writes; unrelated files are preserved. Appears at the end of an assistant response only when workspace files actually changed; each response targets its own before/after snapshots. Requires Checkpoints. This restores workspace files, not model conversation history. |
| Review | A file browser shows staged/unstaged changes against HEAD and untracked file content, with per-file counts, line numbers and colored additions/deletions. Review with agent starts a read-only inspection. |
| Skills | pi discovers project `.pi/skills`, `.agents/skills` and explicitly registered global skill folders. Skills appear in the UI and pi system prompt; `/skill:name` invokes discovered instructions. Arbitrary project extension code is not auto-loaded. |

The shell is an approved local shell, not an OS sandbox. File tools validate project paths and symlinks; approving a shell or MCP server can grant access outside the workspace. Read only blocks all such operations. External network effects, shell changes outside the project and MCP effects cannot be undone by file checkpoints.

Checkpoints stop rather than silently omit unsupported files: maximum 4,000 files, 8 MiB per file and approximately 36 MiB total. Symlinks/non-regular files are rejected. Ignore large generated artifacts before using an agent. Snapshot files may contain source-code secrets and are stored with owner-only permissions. There is currently no automatic checkpoint retention cleanup.

One conversation can run per project directory at a time, preventing overlapping writes/restores. Other projects can run independently. Stop cancels the root session, children and pending approvals. pi JSONL history resumes by project/chat after restart; the renderer keeps visible messages in localStorage.

## Architecture

- `electron/agent/runtime.ts`: pi lifecycle, streaming, bundled tools and session persistence.
- `electron/agent/permissions.ts`: execution gate and pending approvals.
- `electron/agent/storage.ts`: project paths, atomic state, checkpoint restore/conflicts and review diff.
- `electron/agent/mcp.ts`, `web.ts`: bounded MCP and web adapters.
- `shared/agent.ts`: typed IPC contract and bundled plugin manifest.
- `electron/agent/ipc.ts`, `electron/preload.ts`: Electron bridge.
- `src/hooks/use-agent-events.ts`: shared event store that survives chat navigation.
- `src/pages/project.tsx`: live AI Elements conversation, plan, reasoning, approvals, per-response file diffs and context usage.

Runtime configuration, workspace memory, checkpoints and pi sessions live under Electron `userData/agent/`. No credentials belong in project memory or MCP command arguments.

## Verify and package

```sh
yarn typecheck
yarn test
yarn lint
yarn build:app             # Renderer + Electron bundles
yarn package:dir           # Unpacked desktop app using the installed Electron
yarn build                 # Platform installer
```

`tests/agent.test.ts` runs the real pi SDK against a local SSE model fixture and a real MCP stdio fixture. It covers streaming/tool execution, permissions, read-only enforcement, persistent history/memory, subagents, plugin toggles, file restore conflicts and review. Tests need localhost and subprocess access; they do not call a paid model.

pi/MCP remain external production dependencies in the Electron bundle so their native modules, package resources and dynamic imports are included correctly by electron-builder. AI Elements are registry-installed source components adapted to the existing Base UI primitives and Gravity icons.

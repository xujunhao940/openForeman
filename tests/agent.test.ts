import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {execFileSync} from 'node:child_process'
import {CheckpointStore, workspaceDir, safeProjectFile, workspaceDiff, workspaceReview} from '../electron/agent/storage'
import {PermissionGate} from '../electron/agent/permissions'
import {AgentRuntime, foremanModeSubagentLimit, type RunOptions} from '../electron/agent/runtime'
import {projectToolOutputs} from '../electron/agent/tool-output'
import {connectMcp} from '../electron/agent/mcp'
import {modernWebGuidancePaths, modernWebGuidanceTools} from '../electron/agent/modern-web-guidance'
import {fetchPublicPage} from '../electron/agent/web'
import {defaultAgentConfig, type AgentConfig, type AgentEvent, type RunRequest} from '../shared/agent'

const config = (): AgentConfig => structuredClone(defaultAgentConfig)
const temp = async () => realpath(await mkdtemp(path.join(tmpdir(), 'foreman-test-')))

test('tool output references stay inside the current request and explicit pages remain readable', () => {
    const text = '0123456789'.repeat(2000)
    const original = {role: 'toolResult' as const, toolName: 'read', toolCallId: 'first', timestamp: 1, isError: false,
        content: [{type: 'text' as const, text}]}
    const again = {...original, toolCallId: 'second', isError: true}
    const page = {...original, toolName: 'read_tool_output', content: [{type: 'text' as const, text: text.slice(0, 8000)}]}
    for (const paging of [false, true]) {
        const projected = projectToolOutputs([original, again, page, page], paging)
        const serialized = JSON.stringify(projected[1])
        assert.match(serialized, /callId=first, block=0/)
        assert.match(serialized, /"isError":true/)
        assert.equal(projected[2], page)
        assert.equal(projected[3], page)
        assert.doesNotMatch(JSON.stringify(projectToolOutputs([again], paging)), /callId=first|Identical to/)
    }
    assert.equal(original.content[0].text, text)
    assert.deepEqual(projectToolOutputs([original], false)[0], original)
    assert.match(JSON.stringify(projectToolOutputs([original], true)), /read_tool_output/)
})

test('Foreman Mode scales subagent concurrency with reasoning effort', () => {
    assert.deepEqual(['low', 'medium', 'high', 'xhigh'].map(foremanModeSubagentLimit), [3, 6, 9, 12])
})

test('bundled modern web guidance skills and search tools enforce project opt-in', async () => {
    const root = await temp()
    try {
        await mkdir(path.join(root, '.git'))
        assert.equal(modernWebGuidancePaths().length, 2)
        const [search, retrieve] = modernWebGuidanceTools(root)
        const searchResult = await search.execute('search', {query: 'responsive container queries'}, undefined, undefined, {} as never)
        assert.match(JSON.stringify(searchResult.content), /responsive-design/)
        const retrieved = await retrieve.execute('retrieve', {ids: ['responsive-design']}, undefined, undefined, {} as never)
        assert.match(JSON.stringify(retrieved.content), /responsive-design/)
        await assert.rejects(retrieve.execute('retrieve', {ids: ['language-model']}, undefined, undefined, {} as never), /requires explicit project opt-in/)
        await writeFile(path.join(root, '.mwgrc'), JSON.stringify({allowVolatileFeatures: true}))
        const optedIn = await retrieve.execute('retrieve', {ids: ['language-model']}, undefined, undefined, {} as never)
        assert.match(JSON.stringify(optedIn.content), /LanguageModel/)
    } finally { await rm(root, {recursive: true, force: true}) }
})

test('checkpoints restore writes, additions and deletions, preserve unrelated edits, and reject conflicts', async () => {
    const root = await temp()
    try {
        const cwd = path.join(root, 'project'); await mkdir(cwd)
        await writeFile(path.join(cwd, 'a.txt'), 'before')
        const store = new CheckpointStore(path.join(root, 'state'), cwd)
        const before = await store.capture('before')
        await writeFile(path.join(cwd, 'a.txt'), 'after')
        await writeFile(path.join(cwd, 'new.txt'), 'new')
        const changes = await store.finishRun(before.id)
        assert.deepEqual(changes.files.map(file => file.path).sort(), ['a.txt', 'new.txt'])
        const after = {id: changes.afterId}
        assert.deepEqual((await store.finishRun(after.id)).files, [])
        assert.deepEqual((await store.finishRun(before.id)).files, changes.files)
        await writeFile(path.join(cwd, 'unrelated.txt'), 'keep me')
        await store.restore(before.id)
        assert.equal(await readFile(path.join(cwd, 'a.txt'), 'utf8'), 'before')
        await assert.rejects(readFile(path.join(cwd, 'new.txt')), {code: 'ENOENT'})
        assert.equal(await readFile(path.join(cwd, 'unrelated.txt'), 'utf8'), 'keep me')
        await store.restore(after.id)
        assert.equal(await readFile(path.join(cwd, 'new.txt'), 'utf8'), 'new')
        await writeFile(path.join(cwd, 'a.txt'), 'manual change')
        await assert.rejects(store.restore(before.id), /Restore conflict/)
        assert.equal(await readFile(path.join(cwd, 'new.txt'), 'utf8'), 'new')
        await assert.rejects(safeProjectFile(cwd, '../outside.txt'), /inside the project/)
        await symlink(root, path.join(cwd, 'outside'))
        await assert.rejects(safeProjectFile(cwd, 'outside/file.txt'), /Symlink/)
        await assert.rejects(safeProjectFile(cwd, '.git/config'), /outside .git/)
    } finally { await rm(root, {recursive: true, force: true}) }
})

test('auto-mode MCP discovery refills a free slot and preserves configured tool order', async () => {
    const ids = ['first', 'second', 'third', 'fourth', 'fifth']
    const servers = ids.map(id => ({id, name: id, enabled: true, transport: 'stdio' as const,
        command: process.execPath, args: [path.resolve('tests/fixtures/mcp-server.mjs')]}))
    let releaseFirst: () => void
    const firstReady = new Promise<void>(resolve => { releaseFirst = resolve })
    const signal = AbortSignal.timeout(5000)
    signal.addEventListener('abort', () => releaseFirst(), {once: true})
    const connection = await connectMcp(servers, async name => {
        if (name.endsWith(':first')) await firstReady
        if (name.endsWith(':fifth')) releaseFirst()
    }, signal, true)
    try {
        assert.deepEqual(connection.tools.map(tool => tool.name), ids.map(id => `mcp_${id}_ping`))
    } finally { await connection.close() }
})

test('permission gate blocks plan/read-only writes, denies disabled approvals, resolves aborts', async () => {
    const pending: string[] = []
    const gate = new PermissionGate(request => pending.push(request.id), () => {})
    const settings = config()
    await assert.rejects(gate.check(settings, 'plan', 'r', 'write', {}, true, true), /Read-only/)
    settings.permissionMode = 'read-only'
    await assert.rejects(gate.check(settings, 'build', 'r', 'bash', {}, true, true), /Read-only/)
    settings.permissionMode = 'ask'
    const request = gate.check(settings, 'build', 'r', 'write', {}, true, true)
    assert.equal(pending.length, 1)
    gate.approve(pending[0], false)
    await assert.rejects(request, /denied/)
    const abort = new AbortController()
    const waiting = gate.check(settings, 'build', 'r2', 'write', {}, true, true, abort.signal)
    abort.abort()
    await assert.rejects(waiting)
    settings.plugins['permission-system'] = false
    settings.permissionMode = 'auto'
    await assert.rejects(gate.check(settings, 'build', 'r', 'write', {}, true, true), /disabled/)
})

test('web fetch rejects loopback and private destinations before fetching', async () => {
    await assert.rejects(fetchPublicPage('http://127.0.0.1/test'), /public internet/)
    await assert.rejects(fetchPublicPage('http://[::1]/test'), /public internet/)
    await assert.rejects(fetchPublicPage('file:///etc/passwd'), /public HTTP/)
})

test('MCP stdio connects, discovers tools, requires authorization and executes a real server', async () => {
    const calls: string[] = []
    const connection = await connectMcp([{id: 'test', name: 'Test', enabled: true, transport: 'stdio', command: process.execPath,
        args: [path.resolve('tests/fixtures/mcp-server.mjs')]}], async name => { calls.push(name) }, new AbortController().signal)
    try {
        assert.equal(connection.tools.length, 1)
        const result = await connection.tools[0].execute('call', {}, undefined, undefined, {} as never)
        assert.match(JSON.stringify(result.content), /pong/)
        assert.deepEqual(calls, ['mcp:connect:Test', 'mcp_test_ping'])
    } finally { await connection.close() }
})

test('MCP Streamable HTTP discovers and executes tools over the HTTP transport', async () => {
    const server = createServer(async (request, response) => {
        const mcp = new McpServer({name: 'http-fixture', version: '1.0.0'})
        mcp.registerTool('ping', {description: 'Ping'}, async () => ({content: [{type: 'text', text: 'HTTP pong'}]}))
        const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})
        response.on('close', () => { void transport.close(); void mcp.close() })
        await mcp.connect(transport)
        await transport.handleRequest(request, response)
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const port = (server.address() as {port: number}).port
    const connection = await connectMcp([{id: 'http', name: 'HTTP fixture', enabled: true, transport: 'http', url: `http://127.0.0.1:${port}/mcp`}], async () => {}, new AbortController().signal)
    try {
        const result = await connection.tools[0].execute('call', {}, undefined, undefined, {} as never)
        assert.match(JSON.stringify(result.content), /HTTP pong/)
    } finally {
        await connection.close()
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
    }
})

test('pi runtime streams actual SDK events, gates writes, persists sessions, and honors plan mode and plugin toggles', {timeout: 60000}, async () => {
    const root = await temp()
    const requests: Record<string, unknown>[] = []
    const questions = ['Inspect this repository and report findings.', 'Identify missing regression tests.']
    let arrivals = 0
    let releasePair: () => void
    const pairReady = new Promise<void>(resolve => { releasePair = resolve })
    const server = createServer(async (req, res) => {
        try {
            let raw = ''; for await (const part of req) raw += part
            const body = JSON.parse(raw); requests.push(body)
            const messages = body.messages
            const lastUser = messages.map((message: {role: string}) => message.role).lastIndexOf('user')
            const text = JSON.stringify(messages[lastUser]?.content)
            const reviewingAction = messages.some((message: {role: string; content: unknown}) => message.role === 'system' && JSON.stringify(message.content).includes('You review proposed tool actions'))
            const alreadyCalled = messages.slice(lastUser + 1).some((message: {role: string}) => message.role === 'tool')
            const foremanMode = messages.some((message: {role: string; content: unknown}) => message.role === 'system' && JSON.stringify(message.content).includes('Foreman Mode is enabled'))
            const write = /WRITE/.test(text)
            const plan = /PLAN/.test(text)
            const delegate = /DELEGATE/.test(text)
            const delegateNow = delegate || (foremanMode && !alreadyCalled)
            const readGlobal = /READ_GLOBAL/.test(text)
            const childResearch = questions.some(question => text.includes(question))
            if (childResearch && !alreadyCalled && arrivals < 2) {
                if (++arrivals === 2) releasePair()
                await pairReady
            }
            const pageTask = text.includes('READ_PAGED_RESULT')
            const catalogTask = text.includes('Find a record in the library')
            const toolNames = body.tools?.map((tool: {function: {name: string}}) => tool.function.name) ?? []
            const catalogStep = messages.slice(lastUser + 1).filter((message: {role: string}) => message.role === 'tool').length
            const lookup = 'mcp_library_lookup_3'
            const load = catalogTask && !alreadyCalled && !toolNames.includes(lookup)
            const callLookup = catalogTask && toolNames.includes(lookup) && catalogStep < 2
                && !messages.slice(lastUser + 1).some((m: {role: string; content: string}) => m.role === 'tool' && JSON.stringify(m.content).includes('record 3'))
            const readingPage = pageTask && catalogStep === 1 && toolNames.includes('read_tool_output')
            const readCall = readingPage ? messages.findLast((m: {role: string}) => m.role === 'tool') : undefined
            const tool = pageTask && !alreadyCalled ? {name: 'read', arguments: JSON.stringify({path: 'large.txt'})}
                : readingPage ? {name: 'read_tool_output', arguments: JSON.stringify({callId: readCall.tool_call_id, block: 0, offset: 6000})}
                : load ? {name: 'load_mcp_tools', arguments: JSON.stringify({names: [lookup]})}
                : callLookup ? {name: lookup, arguments: '{}'}
                : childResearch ? {name: 'read', arguments: JSON.stringify({path: 'README.md'})}
                : write ? {name: 'write', arguments: JSON.stringify({path: 'output.txt', content: 'from pi'})}
                : plan ? {name: 'update_plan', arguments: JSON.stringify({steps: ['Inspect project', 'Implement change']})}
                : delegateNow ? {name: 'subagent', arguments: JSON.stringify(text.includes('SOLO') ? {task: questions[0]} : {tasks: text.includes('SINGLE') ? questions.slice(0, 1) : text.includes('DUPLICATE') ? [questions[0], questions[0]] : questions})}
                : readGlobal ? {name: 'read', arguments: JSON.stringify({path: path.join(root, 'global-skill', 'SKILL.md')})} : null
            res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'})
            const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{index: 0, delta, finish_reason}]})}\n\n`)
            chunk({role: 'assistant'})
            if (reviewingAction) {
                chunk({content: /WRITE_REVIEW_ASK/.test(text) ? 'ASK' : 'APPROVE'}); chunk({}, 'stop')
            } else if (tool && (!alreadyCalled || callLookup || readingPage)) {
                if (childResearch) chunk({content: 'Unverified preliminary hypothesis'})
                chunk({tool_calls: [{index: 0, id: `call_${Date.now()}`, type: 'function', function: tool}]})
                chunk({}, 'tool_calls')
            } else if (text.includes('STREAM_PROBE')) {
                for (let i = 0; i < 120; i++) chunk({content: 'a'})
                chunk({}, 'stop')
            } else { chunk({content: 'Verified pi response'}); chunk({}, 'stop') }
            res.write(`data: ${JSON.stringify({choices: [], usage: {prompt_tokens: 10, completion_tokens: 3, total_tokens: 13}})}\n\n`)
            res.end('data: [DONE]\n\n')
        } catch (error) { res.writeHead(500); res.end(String(error)) }
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address() as {port: number}
    const cwd = path.join(root, 'project'); await mkdir(cwd)
    await writeFile(path.join(cwd, 'README.md'), 'test project')
    const events: AgentEvent[] = []
    const dataDir = path.join(root, 'data')
    let approve = true
    let runtime = new AgentRuntime(dataDir, event => {
        events.push(event)
        if (event.type === 'permission') {
            // The tool must still be waiting when the UI receives the request.
            if (event.request.tool === 'write') assert.equal(events.some(item => item.type === 'tool' && item.tool.name === 'write' && item.tool.state === 'done'), false)
            if (event.chatId === 'queue-test') {
                for (const text of ['one', 'two', 'three']) runtime.enqueue(event.chatId, text)
                const queue = events.findLast(e => e.type === 'queue')
                assert.ok(queue?.type === 'queue')
                const [, second, third] = queue.items
                runtime.updateQueue(event.chatId, second.id, {kind: 'up'})
                runtime.updateQueue(event.chatId, second.id, {kind: 'edit', text: 'edited second'})
                runtime.updateQueue(event.chatId, third.id, {kind: 'steer'})
                setTimeout(() => runtime.approve(event.request.id, approve), 120)
                return
            }
            runtime.approve(event.request.id, approve)
        }
    }, async () => 'test-key')
    const request = (chatId: string, text: string, mode: RunRequest['mode'] = 'build'): RunRequest => ({chatId, text, mode, projectPath: cwd,
        provider: {id: 'mock', name: 'Mock', preset: 'custom', baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['mock-model']},
        modelId: 'mock-model', effort: 'medium'})
    async function run(input: RunRequest, options: RunOptions = {}) {
        events.length = 0
        const {runId} = await runtime.start(input, options)
        await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => { clearInterval(timer); reject(new Error(`Run timeout: ${JSON.stringify(events)}`)) }, 15000)
            const timer = setInterval(() => {
                if (events.some(event => event.runId === runId && event.type === 'status' && ['done', 'error', 'stopped'].includes(event.status))) {
                    clearTimeout(deadline); clearInterval(timer); resolve()
                }
            }, 10)
        })
        const error = events.find(event => event.type === 'status' && event.status === 'error')
        assert.equal(error, undefined, JSON.stringify(error))
        return events.slice()
    }
    try {
        const skillDir = path.join(cwd, '.pi', 'skills', 'fixture-skill')
        await mkdir(skillDir, {recursive: true})
        await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Test project skill discovery.\n---\nInspect files before modifying them.\n')
        const first = await run(request('chat-1', 'WRITE'))
        assert.equal(await readFile(path.join(cwd, 'output.txt'), 'utf8'), 'from pi')
        assert.ok(first.some(event => event.type === 'message' && event.message.text.includes('Verified pi response')))
        assert.ok(first.some(event => event.type === 'permission' && event.request.tool === 'write'))
        const changed = first.findLast(event => event.type === 'message' && event.message.changes)
        assert.ok(changed?.type === 'message' && changed.message.changes)
        assert.deepEqual(changed.message.changes.files.map(file => file.path), ['output.txt'])
        assert.equal(changed.message.changes.files[0].status, 'added')
        assert.match(changed.message.changes.files[0].patch, /from pi/)
        assert.equal(changed.message.changes.files[0].additions, 1)
        assert.ok(changed.message.contextUsage, 'pi context-window usage is attached to assistant messages')
        assert.ok((changed.message.contextUsage.tokens ?? 0) > 0, 'session context estimate is populated after the response')
        assert.ok((changed.message.durationMs ?? 0) > 0, 'assistant response duration is attached per message')
        assert.equal(changed.message.text, 'Verified pi response')
        const state = await runtime.workspace(cwd)
        assert.ok(state.skills.some(skill => skill.name === 'fixture-skill'))
        assert.equal(state.checkpoints.length, 2)
        await runtime.restore(cwd, state.checkpoints[0].id)
        await assert.rejects(readFile(path.join(cwd, 'output.txt')), {code: 'ENOENT'})
        await runtime.restore(cwd, state.checkpoints[1].id)
        assert.equal(await readFile(path.join(cwd, 'output.txt'), 'utf8'), 'from pi')
        await writeFile(path.join(cwd, 'outside-change.txt'), 'independent edit')
        const beforeNoop = await run(request('chat-skill-sync', 'Hello'))
        const stable = beforeNoop.find(event => event.type === 'workspace')
        assert.ok(stable?.type === 'workspace')
        assert.deepEqual(stable.workspace.checkpoints, state.checkpoints, 'chat does not snapshot independent edits')
        await rm(path.join(cwd, 'outside-change.txt'))
        const requestCount = requests.length
        const queued = await run(request('queue-test', 'WRITE'))
        assert.deepEqual(queued.flatMap(event => event.type === 'message' && event.message.role === 'user' ? [event.message.text] : []), ['three', 'edited second', 'one'])
        const summary = queued.find(event => event.type === 'message' && event.message.runSummary)
        assert.ok(summary?.type === 'message')
        assert.ok(summary.message.durationMs! >= 120, 'elapsed time includes the permission wait')
        assert.equal(summary.message.usage?.total, 13 * (requests.length - requestCount))
        const noop = await run({...request('chat-noop', 'WRITE'), permissionMode: 'auto'})
        assert.ok(!noop.some(event => event.type === 'message' && event.message.changes), 'identical writes have no undo footer')
        assert.ok(!noop.some(event => event.type === 'permission'), 'per-run auto mode bypasses approval')
        const reviewed = await run({...request('chat-approved-for-me', 'WRITE_REVIEW_APPROVE'), permissionMode: 'approve-for-me'})
        assert.ok(reviewed.some(event => event.type === 'tool' && event.tool.name === 'write' && event.tool.state === 'done'))
        assert.ok(!reviewed.some(event => event.type === 'permission'), 'an approved review does not prompt the user')
        const needsApproval = await run({...request('chat-approval-fallback', 'WRITE_REVIEW_ASK'), permissionMode: 'approve-for-me'})
        assert.ok(needsApproval.some(event => event.type === 'permission' && event.request.tool === 'write'))
        const unchanged = noop.find(event => event.type === 'workspace')
        assert.ok(unchanged?.type === 'workspace')
        assert.equal(unchanged.workspace.checkpoints[unchanged.workspace.cursor].id, stable.workspace.checkpoints[stable.workspace.cursor].id, 'no-op runs preserve response undo availability')
        assert.equal((await runtime.config()).permissionMode, 'ask', 'per-run overrides preserve defaults')
        await writeFile(path.join(cwd, 'output.txt'), 'manual edit')
        const override = await run({...request('chat-readonly', 'WRITE'), permissionMode: 'read-only'})
        assert.ok(override.some(event => event.type === 'tool' && event.tool.state === 'error' && event.tool.output?.includes('Read-only')))
        assert.equal(await readFile(path.join(cwd, 'output.txt'), 'utf8'), 'manual edit')
        assert.ok(!override.some(event => event.type === 'message' && event.message.changes))
        await writeFile(path.join(cwd, 'output.txt'), 'from pi')
        await runtime.saveMemory(cwd, 'Project conventions persist.')
        await runtime.dispose()
        runtime = new AgentRuntime(dataDir, event => { events.push(event); if (event.type === 'permission') runtime.approve(event.request.id, approve) }, async () => 'test-key')
        await run(request('chat-1', 'Continue this conversation'))
        const lastRequest = requests[requests.length - 1] as {messages: {role: string; content: unknown}[]}
        assert.ok(lastRequest.messages.filter(message => message.role === 'user').length >= 2, 'pi history resumed from disk')
        assert.ok(JSON.stringify(lastRequest.messages).includes('Project conventions persist.'))
        const readonly = await run(request('chat-plan', 'WRITE', 'plan'))
        assert.ok(readonly.some(event => event.type === 'tool' && event.tool.state === 'error' && event.tool.output?.includes('Read-only')))
        assert.ok(!readonly.some(event => event.type === 'permission'))
        const planned = await run(request('chat-plan2', 'PLAN', 'plan'))
        assert.ok(planned.some(event => event.type === 'plan' && event.steps.length === 2))
        const delegated = await run({...request('chat-delegate', 'DELEGATE'), foremanMode: true})
        assert.equal(arrivals, 2)
        assert.equal(delegated.filter(event => event.type === 'subagent' && event.agent.state === 'done' && event.agent.text === 'Verified pi response').length, 2)
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /Unverified preliminary hypothesis/)
        for (const invalid of ['SINGLE', 'DUPLICATE']) {
            const rejected = await run({...request(`chat-${invalid}`, `DELEGATE ${invalid}`), foremanMode: true})
            assert.ok(!rejected.some(event => event.type === 'subagent'))
            assert.ok(rejected.some(event => event.type === 'tool' && event.tool.state === 'error'))
        }
        const solo = await run(request('chat-solo', 'DELEGATE SOLO'))
        assert.ok(!solo.some(event => event.type === 'subagent'), 'ordinary mode also rejects legacy single-task calls')
        assert.ok(solo.some(event => event.type === 'tool' && event.tool.state === 'error'))
        await run({...request('chat-work', 'Prepare a brief'), workspaceMode: 'work'})
        assert.match(JSON.stringify(requests.at(-1)), /ForemanWork/)
        assert.match(JSON.stringify(requests.at(-1)), /Decision brief:/)
        assert.doesNotMatch(JSON.stringify(requests.at(-1)), /Meeting follow-up:/)
        console.log('Work brief request bytes', Buffer.byteLength(JSON.stringify(requests.at(-1))))
        await run({...request('chat-work-review', '审查会议纪要里的表格', 'review'), workspaceMode: 'work'})
        const reviewPrompt = JSON.stringify(requests.at(-1))
        assert.match(reviewPrompt, /Meeting follow-up:/)
        assert.match(reviewPrompt, /Data analysis:/)
        assert.match(reviewPrompt, /inconsistent figures/)
        assert.doesNotMatch(reviewPrompt, /Presentation outline:/)
        const stream = await run(request('stream-probe', 'STREAM_PROBE'))
        const updates = stream.filter(event => event.type === 'message')
        console.log('Stream probe message events', updates.length)
        assert.ok(updates.length < 120)
        assert.equal(updates.at(-1)?.message.text, 'a'.repeat(120))
        const startRequests = requests.length
        const foreman = await run({...request('chat-foreman', 'Inspect the project'), foremanMode: true})
        console.log("Foreman fixture requests / JSON bytes", requests.length - startRequests, Buffer.byteLength(JSON.stringify(requests.slice(startRequests))))
        assert.equal(requests.length - startRequests, 6, 'Foreman starts two parallel subagents before the final main response')
        assert.equal(foreman.filter(event => event.type === 'subagent' && event.agent.state === 'done').length, 2)
        assert.match(JSON.stringify(requests.slice(startRequests)), /at least two useful, independent research tasks/)
        const globalDir = path.join(root, 'global-skill')
        await mkdir(globalDir)
        await writeFile(path.join(globalDir, 'SKILL.md'), '---\nname: readable-global\ndescription: Global reading fixture.\n---\nUse global conventions.\n')
        const withSkill = await runtime.importSkill(globalDir)
        const globalRead = await run(request('chat-global', 'READ_GLOBAL'))
        assert.ok(globalRead.some(event => event.type === 'tool' && event.tool.state === 'done' && event.tool.output?.includes('Use global conventions.')), 'registered global skill instructions are readable by the real SDK')
        await runtime.saveConfig({...withSkill, globalSkills: withSkill.globalSkills!.map(skill => ({...skill, enabled: false}))})
        const disabledRead = await run(request('chat-global-disabled', 'READ_GLOBAL'))
        assert.ok(disabledRead.some(event => event.type === 'tool' && event.tool.state === 'error' && event.tool.output?.includes('restricted to the project')))
        approve = false
        await run(request('chat-denied', 'WRITE'))
        assert.ok(events.some(event => event.type === 'tool' && event.tool.state === 'error' && event.tool.output?.includes('denied')))
        const next = config(); next.plugins['web-access'] = false; next.plugins.subagents = false; next.plugins.skills = false
        await runtime.saveConfig(next)
        await run(request('chat-plugins', 'Hello'))
        const tools = requests[requests.length - 1].tools as {function: {name: string}}[]
        assert.ok(!tools.some(tool => ['web_fetch', 'subagent'].includes(tool.function.name)))
        const catalogConfig = config()
        catalogConfig.mcpServers = [{id: 'library', name: 'Library', enabled: true, transport: 'stdio', command: process.execPath,
            args: [path.resolve('tests/fixtures/mcp-server.mjs'), '--catalog']}]
        const catalogStart = requests.length
        await run({...request('catalog', 'Find a record in the library'), permissionMode: 'auto'}, {config: catalogConfig})
        console.log('Large MCP catalog first request bytes', Buffer.byteLength(JSON.stringify(requests[catalogStart])))
        console.log('Large MCP catalog task requests / bytes', requests.length - catalogStart, Buffer.byteLength(JSON.stringify(requests.slice(catalogStart))))
        const requestToolNames = (index: number) => (requests[index].tools as {function: {name: string}}[]).map(tool => tool.function.name)
        assert.ok(requestToolNames(catalogStart).includes('load_mcp_tools'))
        assert.ok(!requestToolNames(catalogStart).includes('mcp_library_lookup_3'))
        assert.ok(requestToolNames(catalogStart + 1).includes('mcp_library_lookup_3'))
        assert.ok(!requestToolNames(catalogStart + 1).includes('mcp_library_lookup_4'))
        assert.match(JSON.stringify(requests.at(-1)?.messages), /record 3/)
        const namedStart = requests.length
        await run({...request('catalog-named', 'Find a record in the library using mcp_library_lookup_3'), permissionMode: 'auto'}, {config: catalogConfig})
        assert.ok(requestToolNames(namedStart).includes('mcp_library_lookup_3'))
        assert.equal(requests.length - namedStart, 2)
        await writeFile(path.join(cwd, 'large.txt'), 'a'.repeat(6000) + 'recovered middle' + 'b'.repeat(15000))
        const aliasStart = requests.length
        await run({...request('catalog-short', 'Find a record in the library using lookup 3'), permissionMode: 'auto'}, {config: catalogConfig})
        assert.ok(requestToolNames(aliasStart).includes('mcp_library_lookup_3'))
        assert.equal(requests.length - aliasStart, 2)
        const pageStart = requests.length
        await run(request('page-on-demand', 'READ_PAGED_RESULT'))
        assert.ok(!requestToolNames(pageStart).includes('read_tool_output'))
        assert.ok(requestToolNames(pageStart + 1).includes('read_tool_output'))
        assert.doesNotMatch(JSON.stringify(requests[pageStart + 1].messages), /recovered middle/)
        assert.match(JSON.stringify(requests.at(-1)?.messages), /recovered middle/)
        const savedConfig = await runtime.config()
        const isolatedConfig = config()
        isolatedConfig.mcpServers = [{id: 'test', name: 'Test', enabled: true, transport: 'stdio', command: process.execPath,
            args: [path.resolve('tests/fixtures/mcp-server.mjs')]}]
        await run({...request('chat-mcp-only', 'Hello'), permissionMode: 'auto'}, {config: isolatedConfig, mcpOnly: true})
        const isolatedRequest = requests.at(-1) as {tools: {function: {name: string}}[]; messages: unknown[]}
        assert.deepEqual(isolatedRequest.tools.map(tool => tool.function.name).sort(), ['mcp_test_ping', 'update_plan'])
        assert.doesNotMatch(JSON.stringify(isolatedRequest.messages), /fixture-skill|Project conventions persist/)
        assert.deepEqual(await runtime.config(), savedConfig, 'MCP-only per-run config preserves saved settings')
        assert.equal((await runtime.workspace(cwd)).memory, 'Project conventions persist.')
        assert.ok((await runtime.workspace(cwd)).skills.some(skill => skill.name === 'fixture-skill'), 'project skills remain enabled')
    } finally { await runtime.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, {recursive: true, force: true}) }
})

test('stopping a pending approval cancels the run, clears replay and releases the project lock', async () => {
    const root = await temp()
    const cwd = path.join(root, 'project'); await mkdir(cwd)
    const events: AgentEvent[] = []
    const runtime = new AgentRuntime(path.join(root, 'data'), event => events.push(event), async () => '')
    const next = config()
    next.mcpServers = [{id: 'pending', name: 'Awaiting approval', enabled: true, transport: 'stdio', command: process.execPath, args: []}]
    await runtime.saveConfig(next)
    const request: RunRequest = {chatId: 'pending-chat', projectPath: cwd, text: 'Inspect project', mode: 'build', modelId: 'mock', effort: 'medium',
        provider: {id: 'mock', name: 'Mock', preset: 'custom', baseUrl: 'http://127.0.0.1:1/v1', models: ['mock']}}
    try {
        await runtime.start(request)
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('No permission event')) }, 5000)
            const timer = setInterval(() => {
                if (events.some(event => event.type === 'permission')) { clearInterval(timer); clearTimeout(timeout); resolve() }
            }, 5)
        })
        assert.ok(runtime.replay().some(event => event.type === 'permission'))
        await assert.rejects(runtime.start({...request, chatId: 'other-chat'}), /Another conversation/)
        await assert.rejects(runtime.saveConfig(config()), /Stop active runs/)
        await runtime.stop(request.chatId)
        assert.ok(events.some(event => event.type === 'status' && event.status === 'stopped'))
        assert.ok(!runtime.replay().some(event => event.type === 'permission'))
        await runtime.saveConfig(config())
    } finally { await runtime.dispose(); await rm(root, {recursive: true, force: true}) }
})

test('review diff includes tracked changes and untracked files without changing git index', async () => {
    const cwd = await temp()
    try {
        execFileSync('git', ['init', '-q'], {cwd})
        await writeFile(path.join(cwd, 'tracked.txt'), 'before')
        execFileSync('git', ['add', '.'], {cwd})
        assert.match(await workspaceDiff(cwd), /\+before/, 'review includes staged files before the first commit')
        execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], {cwd})
        await writeFile(path.join(cwd, 'tracked.txt'), 'after')
        await writeFile(path.join(cwd, 'untracked.txt'), 'new')
        const diff = await workspaceDiff(cwd)
        assert.match(diff, /-before/); assert.match(diff, /\+after/); assert.match(diff, /untracked.txt/)
        assert.equal(execFileSync('git', ['diff', '--cached'], {cwd, encoding: 'utf8'}), '')
        await writeFile(path.join(cwd, 'large.txt'), 'generated line\n'.repeat(4000))
        execFileSync('git', ['add', 'large.txt'], {cwd})
        const full = await workspaceDiff(cwd)
        const overview = await workspaceDiff(cwd, {})
        assert.match(overview, /Patch exceeds 16 KiB/)
        assert.match(overview, /4000\t0\tlarge.txt/)
        assert.match(overview, /untracked.txt/)
        const focused = await workspaceDiff(cwd, {path: 'tracked.txt'})
        assert.match(focused, /-before/)
        assert.doesNotMatch(focused, /large.txt|untracked.txt/)
        await assert.rejects(workspaceDiff(cwd, {path: '../outside'}))
        console.log('Review fixture bytes (full / overview / focused)', ...[full, overview, focused].map(value => Buffer.byteLength(value)))
        assert.ok(workspaceDir('/data', cwd).startsWith('/data/workspaces/'))
    } finally { await rm(cwd, {recursive: true, force: true}) }
})


test('global skills import enabled across projects, toggle off, remove and validate folders', async () => {
    const root = await temp()
    const runtime = new AgentRuntime(path.join(root, 'data'), () => {}, async () => '')
    try {
        const a = path.join(root, 'a'), b = path.join(root, 'b'), skill = path.join(root, 'global-skill')
        await Promise.all([mkdir(a), mkdir(b), mkdir(skill)])
        const initialWorkspace = await runtime.workspace(a)
        assert.ok(initialWorkspace.skills.some(item => item.name === 'modern-web-guidance'))
        assert.ok(initialWorkspace.skills.some(item => item.name === 'chrome-extensions'))
        await assert.rejects(runtime.importSkill(skill), /valid SKILL.md/)
        await writeFile(path.join(skill, 'SKILL.md'), '---\nname: global-fixture\ndescription: Shared project instructions.\n---\nUse these global conventions.\n')
        const imported = await runtime.importSkill(skill)
        assert.equal(imported.globalSkills?.[0].enabled, true)
        await assert.rejects(runtime.importSkill(skill), /already added/)
        for (const cwd of [a, b]) assert.ok((await runtime.workspace(cwd)).skills.some(skill => skill.name === 'global-fixture'))
        await runtime.saveConfig({...imported, globalSkills: imported.globalSkills!.map(skill => ({...skill, enabled: false}))})
        assert.ok(!(await runtime.workspace(a)).skills.some(skill => skill.name === 'global-fixture'))
        await runtime.saveConfig({...imported, globalSkills: []})
        assert.ok(!(await runtime.workspace(b)).skills.some(skill => skill.name === 'global-fixture'))
    } finally { await runtime.dispose(); await rm(root, {recursive: true, force: true}) }
})

test('structured review shows staged, unstaged, deleted, renamed, binary and untracked files', async () => {
    const cwd = await temp()
    const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'})
    try {
        git('init', '-q')
        await writeFile(path.join(cwd, 'staged.txt'), 'before\n')
        git('add', '.')
        const unborn = await workspaceReview(cwd)
        assert.equal(unborn.find(file => file.path === 'staged.txt')?.status, 'added')
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial')
        await writeFile(path.join(cwd, 'removed.txt'), 'remove me\n')
        await writeFile(path.join(cwd, 'renamed.txt'), 'move me\n')
        git('add', '.')
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'more files')
        await writeFile(path.join(cwd, 'staged.txt'), 'staged\n')
        git('add', 'staged.txt')
        await writeFile(path.join(cwd, 'staged.txt'), 'final\n')
        await rm(path.join(cwd, 'removed.txt'))
        git('mv', 'renamed.txt', 'new-name.txt')
        await writeFile(path.join(cwd, 'new\nname.txt'), 'first\nsecond')
        await writeFile(path.join(cwd, 'binary.dat'), Buffer.from([0, 1, 2]))
        const indexBefore = git('diff', '--cached', '--binary')
        const files = await workspaceReview(cwd)
        const modified = files.find(file => file.path === 'staged.txt')!
        assert.equal(modified.status, 'modified'); assert.equal(modified.additions, 1); assert.equal(modified.deletions, 1)
        assert.match(modified.patch, /\+final/); assert.match(modified.patch, /-before/)
        assert.equal(files.find(file => file.path === 'removed.txt')?.status, 'deleted')
        assert.equal(files.find(file => file.path === 'renamed.txt')?.status, 'deleted')
        assert.equal(files.find(file => file.path === 'new-name.txt')?.status, 'added')
        assert.equal(files.find(file => file.path === 'binary.dat')?.binary, true)
        assert.equal(files.find(file => file.path === 'new\nname.txt')?.additions, 2)
        assert.equal(git('diff', '--cached', '--binary'), indexBefore)
    } finally { await rm(cwd, {recursive: true, force: true}) }
})

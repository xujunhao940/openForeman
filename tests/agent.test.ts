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
import {AgentRuntime} from '../electron/agent/runtime'
import {connectMcp} from '../electron/agent/mcp'
import {fetchPublicPage} from '../electron/agent/web'
import {defaultAgentConfig, type AgentConfig, type AgentEvent, type RunRequest} from '../shared/agent'

const config = (): AgentConfig => structuredClone(defaultAgentConfig)
const temp = async () => realpath(await mkdtemp(path.join(tmpdir(), 'foreman-test-')))

test('checkpoints restore writes, additions and deletions, preserve unrelated edits, and reject conflicts', async () => {
    const root = await temp()
    try {
        const cwd = path.join(root, 'project'); await mkdir(cwd)
        await writeFile(path.join(cwd, 'a.txt'), 'before')
        const store = new CheckpointStore(path.join(root, 'state'), cwd)
        const before = await store.capture('before')
        await writeFile(path.join(cwd, 'a.txt'), 'after')
        await writeFile(path.join(cwd, 'new.txt'), 'new')
        const after = await store.capture('after')
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
    const server = createServer(async (req, res) => {
        try {
            let raw = ''; for await (const part of req) raw += part
            const body = JSON.parse(raw); requests.push(body)
            const messages = body.messages
            const lastUser = messages.map((message: {role: string}) => message.role).lastIndexOf('user')
            const text = JSON.stringify(messages[lastUser]?.content)
            const alreadyCalled = messages.slice(lastUser + 1).some((message: {role: string}) => message.role === 'tool')
            const write = /WRITE/.test(text)
            const plan = /PLAN/.test(text)
            const delegate = /DELEGATE/.test(text)
            const readGlobal = /READ_GLOBAL/.test(text)
            const tool = write ? {name: 'write', arguments: JSON.stringify({path: 'output.txt', content: 'from pi'})}
                : plan ? {name: 'update_plan', arguments: JSON.stringify({steps: ['Inspect project', 'Implement change']})}
                : delegate ? {name: 'subagent', arguments: JSON.stringify({task: 'Inspect this repository and report findings.'})}
                : readGlobal ? {name: 'read', arguments: JSON.stringify({path: path.join(root, 'global-skill', 'SKILL.md')})} : null
            res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'})
            const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{index: 0, delta, finish_reason}]})}\n\n`)
            chunk({role: 'assistant'})
            if (tool && !alreadyCalled) {
                chunk({tool_calls: [{index: 0, id: `call_${Date.now()}`, type: 'function', function: tool}]})
                chunk({}, 'tool_calls')
            } else { chunk({content: 'Verified pi response'}); chunk({}, 'stop') }
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
            runtime.approve(event.request.id, approve)
        }
    }, async () => 'test-key')
    const request = (chatId: string, text: string, mode: RunRequest['mode'] = 'build'): RunRequest => ({chatId, text, mode, projectPath: cwd,
        provider: {id: 'mock', name: 'Mock', preset: 'custom', baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['mock-model']},
        modelId: 'mock-model', effort: 'off'})
    async function run(input: RunRequest) {
        events.length = 0
        const {runId} = await runtime.start(input)
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
        assert.equal(changed.message.text, 'Verified pi response')
        const skillDir = path.join(cwd, '.pi', 'skills', 'fixture-skill')
        await mkdir(skillDir, {recursive: true})
        await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Test project skill discovery.\n---\nInspect files before modifying them.\n')
        const state = await runtime.workspace(cwd)
        assert.ok(state.skills.some(skill => skill.name === 'fixture-skill'))
        assert.equal(state.checkpoints.length, 2)
        await runtime.restore(cwd, state.checkpoints[0].id)
        await assert.rejects(readFile(path.join(cwd, 'output.txt')), {code: 'ENOENT'})
        await runtime.restore(cwd, state.checkpoints[1].id)
        assert.equal(await readFile(path.join(cwd, 'output.txt'), 'utf8'), 'from pi')
        const beforeNoop = await run(request('chat-skill-sync', 'Hello'))
        const stable = beforeNoop.find(event => event.type === 'workspace')
        assert.ok(stable?.type === 'workspace')
        const noop = await run({...request('chat-noop', 'WRITE'), permissionMode: 'auto'})
        assert.ok(!noop.some(event => event.type === 'message' && event.message.changes), 'identical writes have no undo footer')
        assert.ok(!noop.some(event => event.type === 'permission'), 'per-run auto mode bypasses approval')
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
        const delegated = await run(request('chat-delegate', 'DELEGATE'))
        assert.ok(delegated.some(event => event.type === 'subagent' && event.agent.state === 'done'))
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
    const request: RunRequest = {chatId: 'pending-chat', projectPath: cwd, text: 'Inspect project', mode: 'build', modelId: 'mock', effort: 'off',
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
        execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], {cwd})
        await writeFile(path.join(cwd, 'tracked.txt'), 'after')
        await writeFile(path.join(cwd, 'untracked.txt'), 'new')
        const diff = await workspaceDiff(cwd)
        assert.match(diff, /-before/); assert.match(diff, /\+after/); assert.match(diff, /untracked.txt/)
        assert.equal(execFileSync('git', ['diff', '--cached'], {cwd, encoding: 'utf8'}), '')
        assert.ok(workspaceDir('/data', cwd).startsWith('/data/workspaces/'))
    } finally { await rm(cwd, {recursive: true, force: true}) }
})


test('global skills import enabled across projects, toggle off, remove and validate folders', async () => {
    const root = await temp()
    const runtime = new AgentRuntime(path.join(root, 'data'), () => {}, async () => '')
    try {
        const a = path.join(root, 'a'), b = path.join(root, 'b'), skill = path.join(root, 'global-skill')
        await Promise.all([mkdir(a), mkdir(b), mkdir(skill)])
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

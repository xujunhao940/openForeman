import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {Type} from 'typebox'
import {defineTool, type ToolDefinition} from '@mariozechner/pi-coding-agent'
import type {McpServer} from '../../shared/agent'

export async function connectMcp(servers: McpServer[], authorize: (tool: string, input: unknown, signal?: AbortSignal) => Promise<void>, signal: AbortSignal, parallel = false) {
    const clients: Client[] = []
    const names = new Set<string>()
    const close = async () => { await Promise.allSettled(clients.map(client => client.close())) }
    const cancel = new AbortController()
    const connecting = AbortSignal.any([signal, cancel.signal])
    async function discover(server: McpServer) {
        const tools: ToolDefinition[] = []
        connecting.throwIfAborted()
        await authorize(`mcp:connect:${server.name}`, server, connecting)
        connecting.throwIfAborted()
        const client = new Client({name: 'open-foreman', version: '0.1.0'})
        clients.push(client)
        const transport = server.transport === 'stdio'
            ? new StdioClientTransport({command: server.command, args: server.args, stderr: 'pipe'})
            : new StreamableHTTPClientTransport(new URL(server.url))
        await client.connect(transport, {timeout: 20000, signal: connecting})
        let cursor: string | undefined
        do {
            const result = await client.listTools(cursor ? {cursor} : {}, {signal: connecting, timeout: 20000})
            for (const remote of result.tools) {
                if (names.size >= 100) throw new Error('MCP exposes more than 100 tools. Disable unused servers.')
                const name = `mcp_${server.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}_${remote.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 36)}`
                if (names.has(name)) throw new Error(`Duplicate MCP tool: ${name}`)
                names.add(name)
                tools.push(defineTool({
                    name, label: `${server.name} · ${remote.name}`, description: remote.description ?? remote.name,
                    parameters: Type.Unsafe(remote.inputSchema),
                    execute: async (_id, args, toolSignal) => {
                        await authorize(name, args, toolSignal)
                        const result = await client.callTool({name: remote.name, arguments: args as Record<string, unknown>}, undefined, {signal: toolSignal, timeout: 60000})
                        const blocks = result.content
                        const output = Array.isArray(blocks) && blocks.every(block => block.type === 'text' && typeof block.text === 'string')
                            ? blocks.map(block => block.text).join('\n')
                            : JSON.stringify(blocks)
                        if (result.isError) throw new Error(output.slice(0, 12000))
                        return {content: [{type: 'text', text: output.slice(0, 60000)}], details: {server: server.id}}
                    },
                }))
            }
            cursor = result.nextCursor
        } while (cursor)
        return tools
    }
    const serversToConnect = servers.filter(server => server.enabled)
    const groups = new Array<ToolDefinition[]>(serversToConnect.length)
    let next = 0
    async function connectNext() {
        while (next < serversToConnect.length) {
            const index = next++
            groups[index] = await discover(serversToConnect[index])
        }
    }
    // Keep interactive approvals ordered. In auto mode refill each slot as it finishes.
    const concurrency = Math.min(parallel ? 4 : 1, serversToConnect.length)
    const pending = Array.from({length: concurrency}, connectNext)
    try {
        await Promise.all(pending)
        return {tools: groups.flat(), close}
    } catch (error) {
        cancel.abort()
        await Promise.allSettled(pending)
        await close()
        throw error
    }
}

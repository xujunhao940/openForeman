import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {Type} from 'typebox'
import {defineTool, type ToolDefinition} from '@mariozechner/pi-coding-agent'
import type {McpServer} from '../../shared/agent'

export async function connectMcp(servers: McpServer[], authorize: (tool: string, input: unknown, signal?: AbortSignal) => Promise<void>, signal: AbortSignal) {
    const clients: Client[] = []
    const tools: ToolDefinition[] = []
    const close = async () => { await Promise.allSettled(clients.map(client => client.close())) }
    try {
        for (const server of servers.filter(item => item.enabled)) {
            signal.throwIfAborted()
            await authorize(`mcp:connect:${server.name}`, server, signal)
            const client = new Client({name: 'open-foreman', version: '0.1.0'})
            clients.push(client)
            const transport = server.transport === 'stdio'
                ? new StdioClientTransport({command: server.command, args: server.args, stderr: 'pipe'})
                : new StreamableHTTPClientTransport(new URL(server.url))
            await client.connect(transport, {timeout: 20000, signal})
            let cursor: string | undefined
            do {
                const result = await client.listTools(cursor ? {cursor} : {}, {signal, timeout: 20000})
                for (const remote of result.tools) {
                    if (tools.length >= 100) throw new Error('MCP exposes more than 100 tools. Disable unused servers.')
                    const name = `mcp_${server.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}_${remote.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 36)}`
                    if (tools.some(tool => tool.name === name)) throw new Error(`Duplicate MCP tool: ${name}`)
                    tools.push(defineTool({
                        name, label: `${server.name} · ${remote.name}`, description: remote.description ?? remote.name,
                        parameters: Type.Unsafe(remote.inputSchema),
                        execute: async (_id, args, toolSignal) => {
                            await authorize(name, args, toolSignal)
                            const result = await client.callTool({name: remote.name, arguments: args as Record<string, unknown>}, undefined, {signal: toolSignal, timeout: 60000})
                            if (result.isError) throw new Error(JSON.stringify(result.content).slice(0, 12000))
                            return {content: [{type: 'text', text: JSON.stringify(result.content).slice(0, 60000)}], details: {server: server.id}}
                        },
                    }))
                }
                cursor = result.nextCursor
            } while (cursor)
        }
        return {tools, close}
    } catch (error) { await close(); throw error }
}

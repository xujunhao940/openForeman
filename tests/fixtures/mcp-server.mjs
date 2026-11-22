import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
const server = new McpServer({name: 'foreman-test', version: '1.0.0'})
server.registerTool('ping', {description: 'Return pong'}, async () => ({content: [{type: 'text', text: 'pong'}]}))
if (process.argv.includes('--catalog')) {
    for (let i = 0; i < 80; i++) {
        server.registerTool(`lookup_${i}`, {description: 'Look up the matching record in the configured workspace and return its current value, source file, modification date and associated project metadata.'}, async () => ({content: [{type: 'text', text: `record ${i}`}]}))
    }
}
await server.connect(new StdioServerTransport())

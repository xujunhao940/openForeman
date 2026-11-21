import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'

const port = Number(process.argv[2])
const token = process.argv[3]
const server = new Server({name: 'terminal-bench-environment', version: '1.0.0'}, {capabilities: {tools: {}}})

server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: [{
  name: 'terminal_exec',
  description: 'Start a shell command in the isolated Terminal-Bench task environment. Use this tool for all inspection, edits, and tests. The environment starts in /app. Poll long-running commands with terminal_poll.',
  inputSchema: {type: 'object', properties: {command: {type: 'string'}, timeout_sec: {type: 'integer'}}, required: ['command']},
}, {
  name: 'terminal_poll',
  description: 'Check whether a command started with terminal_exec has finished and retrieve its output.',
  inputSchema: {type: 'object', properties: {job_id: {type: 'string'}}, required: ['job_id']},
}]}))

server.setRequestHandler(CallToolRequestSchema, async request => {
  if (!['terminal_exec', 'terminal_poll'].includes(request.params.name)) throw new Error('Unknown tool')
  const operation = request.params.name === 'terminal_exec' ? 'start' : 'poll'
  const response = await fetch(`http://127.0.0.1:${port}/exec`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
    body: JSON.stringify({operation, ...request.params.arguments}),
    signal: AbortSignal.timeout(50000),
  })
  if (!response.ok) throw new Error(`Environment bridge failed (${response.status}): ${(await response.text()).slice(0, 2000)}`)
  const result = await response.json()
  return {content: [{type: 'text', text: JSON.stringify(result)}], isError: typeof result.return_code === 'number' && result.return_code !== 0}
})

await server.connect(new StdioServerTransport())

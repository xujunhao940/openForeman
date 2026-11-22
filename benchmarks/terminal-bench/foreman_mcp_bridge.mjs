import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'

const port = Number(process.argv[2])
const token = process.argv[3]
const server = new Server({name: 'terminal-bench-environment', version: '1.0.0'}, {capabilities: {tools: {}}})

const maxOutputChars = {
  type: 'integer', minimum: 1000, maximum: 56000,
  description: 'Maximum characters per completed response, shared by stdout and stderr (default 10000). Set on the call retrieving the output.',
}

function excerpt(text, limit) {
  if (text.length <= limit) return text
  const head = Math.floor(limit / 2)
  return text.slice(0, head) + `\n[… ${text.length - limit} characters omitted …]\n` + text.slice(-(limit - head))
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: [{
  name: 'terminal_exec',
  description: 'Start a shell command in the isolated Terminal-Bench task environment. Use this tool for all inspection, edits, and tests. The environment starts in /app. Completed commands return output immediately. Poll only when running is true.',
  annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false},
  inputSchema: {type: 'object', properties: {command: {type: 'string'}, timeout_sec: {type: 'integer'}, max_output_chars: maxOutputChars}, required: ['command']},
}, {
  name: 'terminal_poll',
  description: 'Check whether a command started with terminal_exec has finished and retrieve its output.',
  annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
  inputSchema: {type: 'object', properties: {job_id: {type: 'string'}, max_output_chars: maxOutputChars}, required: ['job_id']},
}]}))

server.setRequestHandler(CallToolRequestSchema, async request => {
  if (!['terminal_exec', 'terminal_poll'].includes(request.params.name)) throw new Error('Unknown tool')
  const operation = request.params.name === 'terminal_exec' ? 'start' : 'poll'
  const limit = request.params.arguments?.max_output_chars ?? 10000
  if (!Number.isInteger(limit) || limit < 1000 || limit > 56000) throw new Error('Invalid max_output_chars')
  const response = await fetch(`http://127.0.0.1:${port}/exec`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
    body: JSON.stringify({operation, ...request.params.arguments}),
    signal: AbortSignal.timeout(50000),
  })
  if (!response.ok) throw new Error(`Environment bridge failed (${response.status}): ${(await response.text()).slice(0, 2000)}`)
  const result = await response.json()
  if (result.running) return {content: [{type: 'text', text: JSON.stringify(result)}]}
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  // Reserve room for diagnostics, and give unused space to the other stream.
  const stderrLimit = Math.min(stderr.length, Math.max(Math.floor(limit / 2), limit - stdout.length))
  const text = [
    `Exit code: ${result.return_code}`,
    stdout && `stdout:\n${excerpt(stdout, limit - stderrLimit)}`,
    stderr && `stderr:\n${excerpt(stderr, stderrLimit)}`,
  ].filter(Boolean).join('\n')
  return {content: [{type: 'text', text}], isError: typeof result.return_code === 'number' && result.return_code !== 0}
})

await server.connect(new StdioServerTransport())

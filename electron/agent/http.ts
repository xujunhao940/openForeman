import {createServer} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {AgentRuntime, RunOptions} from './runtime'
import type {RunRequest} from '../../shared/agent'

// Explicitly enabled local automation. Credentials stay in the application profile.
export async function serveAgent(runtime: AgentRuntime, port: number, token: string) {
    if (!token || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Foreman API configuration.')
    const server = createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        const reply = (status: number, value: unknown) => {
            response.writeHead(status)
            response.end(JSON.stringify(value))
        }
        if (request.headers.authorization !== `Bearer ${token}`) {
            reply(401, {error: 'Unauthorized'})
            return
        }
        try {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1')
            if (request.method === 'GET' && url.pathname === '/health') {
                reply(200, {name: 'Foreman', apiVersion: 1})
                return
            }
            if (request.method === 'GET' && url.pathname === '/events') {
                const runId = url.searchParams.get('runId')
                reply(200, runtime.replay().filter(event => !runId || event.runId === runId))
                return
            }
            if (request.method !== 'POST' || !['/runs', '/stop'].includes(url.pathname)) {
                reply(404, {error: 'Unknown endpoint'})
                return
            }
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of request) {
                size += chunk.length
                if (size > 1024 * 1024) {
                    reply(413, {error: 'Request body exceeds 1 MiB'})
                    return
                }
                chunks.push(Buffer.from(chunk))
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (url.pathname === '/runs') {
                reply(200, await runtime.start(body.request as RunRequest, body.options as RunOptions))
            } else {
                if (typeof body.chatId !== 'string') throw new Error('chatId is required.')
                await runtime.stop(body.chatId)
                reply(200, {stopped: true})
            }
        } catch (error) {
            reply(400, {error: error instanceof Error ? error.message : String(error)})
        }
    })
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
            server.removeListener('error', reject)
            resolve()
        })
    })
    return {server, port: (server.address() as AddressInfo).port}
}

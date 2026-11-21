import {test} from 'node:test'
import assert from 'node:assert/strict'
import {serveAgent} from '../electron/agent/http'
import type {AgentRuntime} from '../electron/agent/runtime'

test('local agent API authenticates, forwards run options and filters events', async () => {
    let received: unknown
    const runtime = {
        replay: () => [{runId: 'a', type: 'status', status: 'done'}, {runId: 'b', type: 'status', status: 'running'}],
        start: async (request: unknown, options: unknown) => { received = {request, options}; return {runId: 'a'} },
        stop: async () => {},
    } as unknown as AgentRuntime
    const {server, port} = await serveAgent(runtime, 0, 'test-token')
    const url = `http://127.0.0.1:${port}`
    const headers = {authorization: 'Bearer test-token', 'content-type': 'application/json'}
    try {
        assert.equal((await fetch(url + '/health')).status, 401)
        assert.equal((await fetch(url + '/health', {headers})).status, 200)
        const body = {request: {chatId: 'test'}, options: {mcpOnly: true}}
        assert.deepEqual(await (await fetch(url + '/runs', {method: 'POST', headers, body: JSON.stringify(body)})).json(), {runId: 'a'})
        assert.deepEqual(received, body)
        assert.deepEqual(await (await fetch(url + '/events?runId=a', {headers})).json(), [{runId: 'a', type: 'status', status: 'done'}])
        assert.equal((await fetch(url + '/runs', {method: 'POST', headers, body: '{'})).status, 400)
        assert.equal((await fetch(url + '/unknown', {headers})).status, 404)
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
})

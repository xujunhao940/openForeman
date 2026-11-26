import assert from 'node:assert/strict'
import {test} from 'node:test'
import {completeSimple, getModel, type Tool} from '@mariozechner/pi-ai'
import {createCodingTools, createReadOnlyTools} from '@mariozechner/pi-coding-agent'
import {compactProjectTools} from '../electron/agent/tool-catalog'

test('compact project tools preserve the wire parameter contracts on Responses and Messages', async () => {
    const original = [...createCodingTools('.'), ...createReadOnlyTools('.').filter(tool => tool.name !== 'read')]
    const external = {name: 'mcp_example_edit', description: 'External tool', parameters: {}}
    const compact = compactProjectTools([...original, external])
    assert.deepEqual([...compact.keys()], original.map(tool => tool.name))
    for (const model of [getModel('openai', 'gpt-4.1'), getModel('anthropic', 'claude-3-5-haiku-20241022')]) {
        const wireTools = async (tools: Tool[]) => {
            let result: unknown[] | undefined
            await completeSimple(model, {tools, messages: [{role: 'user', content: 'Read file', timestamp: 1}]}, {
                apiKey: 'fixture', onPayload(value) {
                    result = (value as {tools: unknown[]}).tools
                    throw new Error('Captured request before send.')
                },
            })
            assert.equal(result?.length, original.length)
            return result!
        }
        const before = await wireTools(original)
        const after = await wireTools([...compact.values()])
        const contract = (tools: unknown[]) => JSON.stringify(tools, (key, value) => key === 'description' ? undefined : value)
        assert.equal(contract(after), contract(before))
        assert.ok(Buffer.byteLength(JSON.stringify(after)) < Buffer.byteLength(JSON.stringify(before)) * 0.75)
    }
})

import {Type} from 'typebox'
import {createAgentSession, defineTool, type AgentSession, type CreateAgentSessionOptions} from '@mariozechner/pi-coding-agent'
import {compactProjectTools, createMcpCatalog} from './tool-catalog'
import {mutatingProjectTools} from './permissions'

const pageSize = 8000

type SessionMessages = AgentSession['messages']

// Resolve references only within this request, including after a branch or compaction.
export function projectToolOutputs(messages: SessionMessages, paging: boolean): SessionMessages {
    const seen = new Map<string, string>()
    let writeNumber = 0
    return messages.map(message => {
        if (message.role === 'assistant' && message.stopReason !== 'error' && message.stopReason !== 'aborted') {
            for (const call of message.content) {
                if (call.type !== 'toolCall' || call.name !== 'write') continue
                // Providers can rewrite call IDs on replay, but keep the order and arguments.
                writeNumber++
                const text = call.arguments.content
                if (typeof text === 'string' && text.length >= 1024 && !seen.has(text)) {
                    seen.set(text, `content argument of write call #${writeNumber}`)
                }
            }
        }
        if (message.role !== 'toolResult' || message.toolName === 'read_tool_output') return message
        const content = message.content.map((part, block) => {
            if (part.type !== 'text' || part.text.length < 1024) return part
            const previous = seen.get(part.text)
            if (previous) return {...part, text: `[Identical to the earlier ${previous}.]`}
            seen.set(part.text, `result from ${message.toolName}, callId=${message.toolCallId}, block=${block}`)

            if (!paging || part.text.length <= 2 * pageSize) return part
            const tailStart = part.text.length - 2000
            const marker = `\n[Characters 6000..${tailStart - 1} omitted. Use read_tool_output with callId=${message.toolCallId}, block=${block}, offset=6000 or later.]\n`
            return {...part, text: part.text.slice(0, 6000) + marker + part.text.slice(tailStart)}
        })
        return {...message, content}
    })
}

// Keep the original result in pi's session. Only the copy sent to the provider is paged.
export async function createForemanSession(options: CreateAgentSessionOptions, {paging = true, readOnly = false, compactBuiltins = false} = {}) {
    const sessionRef: {current?: AgentSession} = {}
    const readOutput = defineTool({
        name: 'read_tool_output', label: 'Read tool output',
        description: 'Read an omitted section of a tool result using the call ID, block index and character offset shown in its preview.',
        parameters: Type.Object({
            callId: Type.String(), block: Type.Integer({minimum: 0}), offset: Type.Integer({minimum: 0}),
        }),
        execute: async (_id, {callId, block, offset}) => {
            const messages = sessionRef.current!.messages
            let message = messages.find(item => item.role === 'toolResult' && item.toolCallId === callId)
            if (!message && !callId.includes('|')) {
                // Responses exposes the call ID and item ID separately; pi joins them with "|".
                const matches = messages.filter(item => item.role === 'toolResult' && item.toolCallId.startsWith(callId + '|'))
                if (matches.length === 1) message = matches[0]
            }
            const part = message?.role === 'toolResult' ? message.content[block] : undefined
            if (part?.type !== 'text') throw new Error('Text block unavailable in this session.')
            return {content: [{type: 'text', text: part.text.slice(offset, offset + pageSize)}], details: {}}
        },
    })
    const catalog = paging ? createMcpCatalog(options.customTools ?? []) : undefined
    const helpers = catalog ? [readOutput, catalog.tool] : [readOutput]
    const created = await createAgentSession(paging ? {...options,
        customTools: [...(options.customTools ?? []), ...helpers], tools: [...(options.tools ?? []), ...helpers.map(tool => tool.name)],
    } : options)
    const session = created.session
    sessionRef.current = session
    const convert = session.agent.convertToLlm
    session.agent.convertToLlm = messages => convert(projectToolOutputs(messages, paging))
    if (paging || readOnly) {
        const builtins = compactBuiltins ? compactProjectTools(options.customTools ?? []) : undefined
        // Only project the provider request. pi retains the registered tools and their execution guards.
        const stream = session.agent.streamFn
        session.agent.streamFn = (model, context, settings) => {
            const visible = catalog?.visibleNames(context.messages)
            const hasPages = paging && session.messages.some(message => message.role === 'toolResult' &&
                message.content.some(part => part.type === 'text' && part.text.length > 2 * pageSize))
            const tools = context.tools?.filter(tool => {
                if (readOnly && mutatingProjectTools.has(tool.name)) return false
                if (tool.name === readOutput.name) return hasPages
                return !visible || !tool.name.startsWith('mcp_') || visible.has(tool.name)
            })
            return stream(model, {...context, tools: builtins ? tools?.map(tool => builtins.get(tool.name) ?? tool) : tools}, settings)
        }
    }
    return created
}

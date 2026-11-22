import {Type} from 'typebox'
import {createAgentSession, defineTool, type AgentSession, type CreateAgentSessionOptions} from '@mariozechner/pi-coding-agent'
import {createMcpCatalog} from './tool-catalog'

const pageSize = 8000

type SessionMessages = AgentSession['messages']

// Resolve references only within this request, including after a branch or compaction.
export function projectToolOutputs(messages: SessionMessages, paging: boolean): SessionMessages {
    const seen = new Map<string, string>()
    return messages.map(message => {
        if (message.role !== 'toolResult' || message.toolName === 'read_tool_output') return message
        const content = message.content.map((part, block) => {
            if (part.type !== 'text' || part.text.length < 1024) return part
            const previous = seen.get(part.text)
            if (previous) return {...part, text: `[Identical to the earlier result from ${previous}.]`}
            seen.set(part.text, `${message.toolName}, callId=${message.toolCallId}, block=${block}`)

            if (!paging || part.text.length <= 2 * pageSize) return part
            const tailStart = part.text.length - 2000
            const marker = `\n[Characters 6000..${tailStart - 1} omitted. Use read_tool_output with callId=${message.toolCallId}, block=${block}, offset=6000 or later.]\n`
            return {...part, text: part.text.slice(0, 6000) + marker + part.text.slice(tailStart)}
        })
        return {...message, content}
    })
}

// Keep the original result in pi's session. Only the copy sent to the provider is paged.
export async function createForemanSession(options: CreateAgentSessionOptions, paging = true) {
    let session: AgentSession
    const readOutput = defineTool({
        name: 'read_tool_output', label: 'Read tool output',
        description: 'Read an omitted section of a tool result using the call ID, block index and character offset shown in its preview.',
        parameters: Type.Object({
            callId: Type.String(), block: Type.Integer({minimum: 0}), offset: Type.Integer({minimum: 0}),
        }),
        execute: async (_id, {callId, block, offset}) => {
            const message = session.messages.find(item => item.role === 'toolResult' && item.toolCallId === callId)
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
    session = created.session
    const convert = session.agent.convertToLlm
    session.agent.convertToLlm = messages => convert(projectToolOutputs(messages, paging))
    if (paging) {
        // Only project the provider request. pi retains the registered tools and their execution guards.
        const stream = session.agent.streamFn
        session.agent.streamFn = (model, context, settings) => {
            const visible = catalog?.visibleNames(context.messages)
            const hasPages = session.messages.some(message => message.role === 'toolResult' &&
                message.content.some(part => part.type === 'text' && part.text.length > 2 * pageSize))
            const tools = context.tools?.filter(tool => {
                if (tool.name === readOutput.name) return hasPages
                return !visible || !tool.name.startsWith('mcp_') || visible.has(tool.name)
            })
            return stream(model, {...context, tools}, settings)
        }
    }
    return created
}

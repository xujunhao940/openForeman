import type {Context} from '@mariozechner/pi-ai'
import {defineTool, type ToolDefinition} from '@mariozechner/pi-coding-agent'
import {Type} from 'typebox'

export function createMcpCatalog(tools: ToolDefinition[]) {
    const remote = tools.filter(tool => tool.name.startsWith('mcp_'))
    if (remote.length < 8) return
    const definitions = remote.map(({name, description, parameters}) => ({name, description, parameters}))
    if (Buffer.byteLength(JSON.stringify(definitions)) < 16 * 1024) return

    // Only infer a tool from its short name when it identifies one server unambiguously.
    const aliases = new Map<string, {name: string; bytes: number} | null>()
    const words = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    for (const definition of definitions) {
        const shortName = definition.name.slice(definition.name.indexOf('_', 4) + 1)
        const alias = words(shortName)
        if (!alias.includes(' ')) continue
        aliases.set(alias, aliases.has(alias) ? null : {name: definition.name, bytes: Buffer.byteLength(JSON.stringify(definition))})
    }
    const names = remote.map(tool => tool.name)
    const catalog = defineTool({
        name: 'load_mcp_tools', label: 'Load MCP tools',
        description: 'Select one or more MCP tools by name to see their parameters and call them on the next step.',
        parameters: Type.Object({names: Type.Array(Type.String({enum: names}), {minItems: 1, uniqueItems: true})}),
        execute: async (_id, {names}) => ({
            content: [{type: 'text', text: `Loaded: ${names.join(', ')}`}],
            details: {names},
        }),
    })

    function visibleNames(messages: Context['messages']) {
        const visible = new Set<string>()
        let lastUser: Extract<Context['messages'][number], {role: 'user'}> | undefined
        for (const message of messages) {
            if (message.role === 'toolResult') {
                visible.add(message.toolName)
                if (message.toolName === catalog.name && !message.isError && Array.isArray(message.details?.names)) {
                    for (const name of message.details.names) visible.add(name)
                }
            } else if (message.role === 'user') {
                const parts = typeof message.content === 'string' ? [{type: 'text' as const, text: message.content}] : message.content
                lastUser = message
                for (const part of parts) {
                    if (part.type === 'text') {
                        for (const match of part.text.matchAll(/\bmcp_[a-zA-Z0-9_-]+/g)) visible.add(match[0])
                    }
                }
            }
        }
        // Bound speculative schema bytes. Every other tool stays available through the catalog.
        const content = lastUser?.content ?? ''
        const text = typeof content === 'string' ? content : content.map(part => part.type === 'text' ? part.text : '').join(' ')
        const query = ' ' + words(text) + ' '
        let remaining = 4096
        for (const [alias, tool] of aliases) {
            if (tool && !visible.has(tool.name) && tool.bytes <= remaining && query.includes(' ' + alias + ' ')) {
                visible.add(tool.name)
                remaining -= tool.bytes
            }
        }
        return visible
    }
    return {tool: catalog, visibleNames}
}

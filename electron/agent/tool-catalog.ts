import type {Context, Tool} from '@mariozechner/pi-ai'
import {defineTool, type ToolDefinition} from '@mariozechner/pi-coding-agent'
import {Type} from 'typebox'

const projectToolDescriptions: Readonly<Record<string, string>> = {
    read: 'Read an absolute or project-relative path. Text offset starts at line 1, limit counts lines. Page past 2000 lines or 50 KiB with offset. JPG, PNG, GIF and WebP return image attachments.',
    bash: 'Run Bash in the project. Returns stdout/stderr tail (2000 lines or 50 KiB) and a temp file for truncated output. Optional timeout in seconds, unlimited by default.',
    edit: 'Edit one absolute or project-relative path. Replace each exact, unique oldText in the original with newText. Merge overlapping edits and keep distant changes separate.',
    write: 'Create or overwrite an absolute or project-relative path with content, creating parent directories.',
    grep: 'Search file contents by regex, or literal text with literal=true. path defaults to cwd. glob filters files, ignoreCase defaults to false, context adds lines on each side (default 0). Returns path:line matches respecting .gitignore, default 100 matches, 50 KiB total, 500 chars per line.',
    find: 'Find files by glob under path (default cwd), respecting .gitignore. Returns relative paths, default 1000 results, up to 50 KiB.',
    ls: 'List path (default cwd), sorted, including dotfiles. Directories end in /. Default 500 entries, up to 50 KiB.',
}

type ProjectParameter = {description?: string; properties?: Record<string, ProjectParameter>; items?: ProjectParameter}
function withoutFieldDescriptions(schema: ProjectParameter): ProjectParameter {
    const copy = {...schema}
    delete copy.description
    if (schema.properties) {
        copy.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, withoutFieldDescriptions(value)]))
    }
    if (schema.items) copy.items = withoutFieldDescriptions(schema.items)
    return copy
}

// Project only the SDK's built-in tools onto the wire. pi validates and executes the originals.
export function compactProjectTools(tools: Tool[]) {
    const compact = new Map<string, Tool>()
    for (const {name, parameters} of tools) {
        if (Object.hasOwn(projectToolDescriptions, name)) {
            compact.set(name, {name, description: projectToolDescriptions[name], parameters: withoutFieldDescriptions(parameters)})
        }
    }
    return compact
}

export function createMcpCatalog(tools: ToolDefinition[]) {
    const remote = tools.filter(tool => tool.name.startsWith('mcp_'))
    if (!remote.length) return
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
        // A completed reply ends its tool selection. Steering before that reply
        // keeps the active tools, and follow-ups can select any tool again.
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i]
            if (message.role === 'assistant' && message.stopReason === 'stop') break
            if (message.role === 'toolResult') {
                visible.add(message.toolName)
                if (message.toolName === catalog.name && !message.isError && Array.isArray(message.details?.names)) {
                    for (const name of message.details.names) visible.add(name)
                }
            } else if (message.role === 'user') {
                const parts = typeof message.content === 'string' ? [{type: 'text' as const, text: message.content}] : message.content
                lastUser ??= message
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

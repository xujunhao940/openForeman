import type {Provider} from '../src/lib/provider-models'

export const bundledPlugins = [
    {id: 'subagents', name: 'Subagents', description: 'Delegate isolated, read-only research sessions to pi agents.'},
    {id: 'plan-mode', name: 'Plan mode', description: 'Inspect and plan with mutations blocked before tool execution.'},
    {id: 'permission-system', name: 'Permissions', description: 'Approve shell commands, writes, network requests and MCP calls.'},
    {id: 'checkpoints', name: 'Checkpoints', description: 'Persist workspace snapshots before and after each agent run.'},
    {id: 'memory', name: 'Memory', description: 'Keep explicit project notes across conversations.'},
    {id: 'web-access', name: 'Web access', description: 'Fetch public HTTP(S) pages with bounded responses.'},
    {id: 'mcp', name: 'MCP', description: 'Connect stdio and Streamable HTTP Model Context Protocol servers.'},
    {id: 'undo-redo', name: 'Undo / redo', description: 'Restore checkpoint file changes with conflict detection.'},
    {id: 'review', name: 'Review', description: 'Inspect tracked and untracked changes and request a read-only review.'},
    {id: 'skills', name: 'Skills', description: 'Discover project SKILL.md instructions through pi resource loading.'},
] as const
export type PluginId = typeof bundledPlugins[number]['id']
export type PermissionMode = 'ask' | 'approve-for-me' | 'read-only' | 'auto'
export type AgentMode = 'build' | 'plan' | 'review'
export type ContextWindow = 128000 | 256000 | 512000
export type McpServer = {id: string; name: string; enabled: boolean} & (
    {transport: 'http'; url: string} | {transport: 'stdio'; command: string; args: string[]}
)
export type AgentConfig = {
    plugins: Record<PluginId, boolean>
    permissionMode: PermissionMode
    mcpServers: McpServer[]
    globalSkills?: {id: string; name: string; path: string; enabled: boolean}[]
}
export const defaultAgentConfig: AgentConfig = {
    plugins: Object.fromEntries(bundledPlugins.map(({id}) => [id, true])) as Record<PluginId, boolean>,
    permissionMode: 'ask', mcpServers: [], globalSkills: [],
}
export type TurnChangeFile = {path: string; status: 'added' | 'modified' | 'deleted'; additions: number; deletions: number; patch: string; binary?: boolean; truncated?: boolean}
export type ContextUsage = {tokens: number | null; contextWindow: number; percent: number | null}
export type QueuedPrompt = {id: string; text: string; steering?: boolean}
export type QueueAction = {kind: 'edit'; text: string} | {kind: 'up' | 'down' | 'steer'}
export type ResponseUsage = {input: number; output: number; cacheRead: number; cacheWrite: number; total: number}
export type ForemanDetails = {enabled: boolean; effort: 'low' | 'medium' | 'high' | 'xhigh'; maxSubagents: number}
export type TurnChanges = {beforeId: string; afterId: string; files: TurnChangeFile[]}
export type AgentMessage = {id: string; role: 'assistant' | 'user'; text: string; reasoning?: string; changes?: TurnChanges; contextUsage?: ContextUsage; runSummary?: boolean; usage?: ResponseUsage; durationMs?: number; modelId?: string; foreman?: ForemanDetails; delivery?: 'steer' | 'waitlist'}
export type ReviewFile = {path: string; status: 'added' | 'modified' | 'deleted'; additions: number; deletions: number; patch: string; binary?: boolean; truncated?: boolean}
export type RunRequest = {
    chatId: string; projectPath: string; text: string; mode: AgentMode
    provider: Provider; modelId: string; effort: 'low' | 'medium' | 'high' | 'xhigh'
    history?: AgentMessage[]
    permissionMode?: PermissionMode
    workspaceMode?: import('./work').WorkspaceMode
    foremanMode?: boolean
    contextWindow?: ContextWindow
}
export type PermissionRequest = {id: string; runId: string; tool: string; input: string}
export type ToolTrace = {id: string; name: string; input: string; output?: string; state: 'running' | 'done' | 'error'}
export type SubagentState = {
    id: string; task: string; state: 'working' | 'done' | 'error'; text?: string
    detail?: string; modelId?: string; startedAt?: number; durationMs?: number
}
export type CheckpointInfo = {id: string; label: string; createdAt: string; files: number}
export type WorkspaceState = {
    checkpoints: CheckpointInfo[]; cursor: number; memory: string
    skills: {name: string; description: string; filePath: string}[]
}
export type AgentEvent = {chatId: string; runId: string} & (
    {type: 'status'; status: 'starting' | 'running' | 'done' | 'error' | 'stopped'; error?: string} |
    {type: 'message'; message: AgentMessage} |
    {type: 'tool'; tool: ToolTrace} |
    {type: 'permission'; request: PermissionRequest} |
    {type: 'permission-resolved'; id: string} |
    {type: 'subagent'; agent: SubagentState} |
    {type: 'queue'; items: QueuedPrompt[]} |
    {type: 'plan'; steps: string[]} |
    {type: 'workspace'; workspace: WorkspaceState}
)
export interface AgentAPI {
    config(): Promise<AgentConfig>
    saveConfig(config: AgentConfig): Promise<AgentConfig>
    start(request: RunRequest): Promise<{runId: string}>
    stop(chatId: string): Promise<void>
    approve(id: string, approved: boolean): Promise<void>
    enqueue(chatId: string, text: string): Promise<void>
    updateQueue(chatId: string, id: string, action: QueueAction): Promise<void>
    workspace(projectPath: string): Promise<WorkspaceState>
    saveMemory(projectPath: string, text: string): Promise<void>
    restore(projectPath: string, checkpointId: string): Promise<WorkspaceState>
    diff(projectPath: string): Promise<string>
    review(projectPath: string): Promise<ReviewFile[]>
    importSkill(directory: string): Promise<AgentConfig>
    selectDirectory(): Promise<string | null>
    replay(): Promise<AgentEvent[]>
    subscribe(listener: (event: AgentEvent) => void): () => void
}

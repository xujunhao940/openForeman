import {randomUUID} from 'node:crypto'
import type {AgentConfig, AgentMode, PermissionRequest} from '../../shared/agent'

export class PermissionGate {
    private pending = new Map<string, {runId: string; resolve: (approved: boolean) => void}>()
    constructor(private notify: (request: PermissionRequest) => void, private resolved: (id: string) => void) {}
    async check(config: AgentConfig, mode: AgentMode, runId: string, tool: string, input: unknown, mutation: boolean, sensitive: boolean, signal?: AbortSignal, review?: () => Promise<boolean>) {
        signal?.throwIfAborted()
        if (mutation && (mode !== 'build' || config.permissionMode === 'read-only')) throw new Error('Read-only mode blocks this tool.')
        if (!sensitive) return
        // Turning the plugin off never grants permissions; it removes approvals and fails closed.
        if (!config.plugins['permission-system']) throw new Error('Permissions plugin is disabled. Sensitive tools are unavailable.')
        if (config.permissionMode === 'auto') return
        if (config.permissionMode === 'approve-for-me' && review) {
            let approved = false
            try { approved = await review() } catch { /* If review fails, request human approval. */ }
            signal?.throwIfAborted()
            if (approved) return
        }
        const id = randomUUID()
        const approved = await new Promise<boolean>(resolve => {
            const abort = () => finish(false)
            const finish = (value: boolean) => {
                clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
                this.pending.delete(id)
                this.resolved(id)
                resolve(value)
            }
            this.pending.set(id, {runId, resolve: finish})
            signal?.addEventListener('abort', abort, {once: true})
            const timer = setTimeout(() => finish(false), 5 * 60 * 1000)
            this.notify({id, runId, tool, input: JSON.stringify(input, null, 2).slice(0, 12000)})
        })
        signal?.throwIfAborted()
        if (!approved) throw new Error('User denied this tool request or approval expired.')
    }
    approve(id: string, approved: boolean) {
        const pending = this.pending.get(id)
        if (!pending) throw new Error('This permission request is no longer pending.')
        pending.resolve(approved)
    }
    cancel(runId: string) {
        for (const value of [...this.pending.values()]) if (value.runId === runId) value.resolve(false)
    }
}

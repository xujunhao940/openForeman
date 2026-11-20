import {useEffect, useRef, useSyncExternalStore} from 'react'
import type {AgentEvent, QueuedPrompt, PermissionRequest, SubagentState, ToolTrace, WorkspaceState} from '../../shared/agent'

export type RunState = {
    status: 'idle' | 'starting' | 'running' | 'done' | 'error' | 'stopped'
    error?: string; tools: ToolTrace[]; agents: SubagentState[]; permissions: PermissionRequest[]; steps: string[]
    queue: QueuedPrompt[]; workspace?: WorkspaceState
}
const empty: RunState = {status: 'idle', queue: [], tools: [], agents: [], permissions: [], steps: []}
const states = new Map<string, RunState>()
const listeners = new Set<() => void>()
let subscribed = false
function ensureSubscription() {
    if (subscribed || !window.agentAPI) return
    subscribed = true
    const receive = (event: AgentEvent) => {
        const prior = states.get(event.chatId) ?? empty
        let next = prior
        if (event.type === 'status') next = event.status === 'starting'
            ? {...empty, status: event.status, workspace: prior.workspace}
            : {...prior, status: event.status, error: event.error, permissions: ['done', 'error', 'stopped'].includes(event.status) ? [] : prior.permissions}
        if (event.type === 'tool') next = {...prior, tools: [...prior.tools.filter(tool => tool.id !== event.tool.id), event.tool]}
        if (event.type === 'subagent') next = {...prior, agents: [...prior.agents.filter(agent => agent.id !== event.agent.id), event.agent]}
        if (event.type === 'permission') next = {...prior, permissions: [...prior.permissions, event.request]}
        if (event.type === 'permission-resolved') next = {...prior, permissions: prior.permissions.filter(request => request.id !== event.id)}
        if (event.type === 'queue') next = {...prior, queue: event.items}
        if (event.type === 'plan') next = {...prior, steps: event.steps}
        if (event.type === 'workspace') next = {...prior, workspace: event.workspace}
        if (next !== prior) { states.set(event.chatId, next); listeners.forEach(listener => listener()) }
        eventListeners.forEach(listener => listener(event))
    }
    // Subscribe first, replay the main-process snapshot, then drain events received
    // during replay. Reloading a window must not lose an outstanding approval.
    let ready = false
    const queued: AgentEvent[] = []
    window.agentAPI.subscribe(event => { if (ready) receive(event); else queued.push(event) })
    void window.agentAPI.replay().then(events => events.forEach(receive)).catch(error => {
        console.error('Could not restore agent runtime events.', error)
    }).finally(() => {
        ready = true
        queued.forEach(receive)
    })
}
const eventListeners = new Set<(event: AgentEvent) => void>()
export function useAgentEvents(listener: (event: AgentEvent) => void) {
    const ref = useRef(listener)
    ref.current = listener
    useEffect(() => {
        ensureSubscription()
        const wrapped = (event: AgentEvent) => ref.current(event)
        eventListeners.add(wrapped)
        return () => { eventListeners.delete(wrapped) }
    }, [])
}
const subscribe = (listener: () => void) => { ensureSubscription(); listeners.add(listener); return () => { listeners.delete(listener) } }
export function useAgentRun(chatId?: string) {
    return useSyncExternalStore(subscribe, () => states.get(chatId ?? '') ?? empty)
}

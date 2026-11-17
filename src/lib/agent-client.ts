import {defaultAgentConfig, type AgentConfig} from '../../shared/agent'
import {modelsUnion, type ModelPreference, type Provider} from './provider-models'

export const permissionOptions = [
    {value: 'ask', label: 'Ask before actions'},
    {value: 'read-only', label: 'Read only'},
    {value: 'auto', label: 'Allow all actions'},
]

export function agentAPI() {
    if (!window.agentAPI) throw new Error('Open Foreman in the desktop app to run pi agents and workspace tools.')
    return window.agentAPI
}
export async function readAgentConfig(): Promise<AgentConfig> {
    if (window.agentAPI) return window.agentAPI.config()
    try { return {...defaultAgentConfig, ...JSON.parse(localStorage.getItem('foreman_agent_preview_v1') ?? 'null')} }
    catch { return defaultAgentConfig }
}
export async function saveAgentConfig(config: AgentConfig) {
    if (window.agentAPI) return window.agentAPI.saveConfig(config)
    localStorage.setItem('foreman_agent_preview_v1', JSON.stringify(config))
    return config
}
export function configuredModels() {
    try {
        const settings = JSON.parse(localStorage.getItem('foreman_settings') ?? '{}') as {providers?: Provider[]; modelPreferences?: Record<string, ModelPreference>}
        return modelsUnion(settings.providers ?? [], settings.modelPreferences ?? {}).filter(model => model.enabled)
    } catch { return [] }
}

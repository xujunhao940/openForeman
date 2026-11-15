export type Provider = {
    id: string
    name: string
    preset: 'openai' | 'custom'
    baseUrl: string
    models: string[]
}

export type ModelPreference = {providerId: string; enabled: boolean}
export type Model = {id: string; providers: Provider[]; providerId: string; enabled: boolean}

export function modelsUnion(providers: Provider[], preferences: Record<string, ModelPreference>): Model[] {
    const models = new Map<string, Provider[]>()
    for (const provider of providers) {
        for (const id of new Set(provider.models)) models.set(id, [...(models.get(id) ?? []), provider])
    }
    return Array.from(models, ([id, available]) => ({
        id,
        providers: available,
        providerId: available.find((provider) => provider.id === preferences[id]?.providerId)?.id ?? available[0].id,
        enabled: preferences[id]?.enabled ?? true,
    })).sort((a, b) => a.id.localeCompare(b.id))
}

export function modelsEndpoint(baseUrl: string): string {
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Enter an HTTP(S) base URL without credentials, query parameters or fragments.')
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
    return url.toString()
}

export async function requestModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const response = await fetch(modelsEndpoint(baseUrl), {
        headers: apiKey ? {Authorization: `Bearer ${apiKey}`} : {},
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
    })
    if (!response.ok) throw new Error(`Fetch Models failed (HTTP ${response.status}). Check the base URL and API key.`)
    const result: unknown = await response.json()
    if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data)) {
        throw new Error('Invalid response. Expected an OpenAI-compatible model list: { data: [{ id }] }.')
    }
    if (result.data.some((model) => !model || typeof model.id !== 'string' || !model.id.trim())) {
        throw new Error('Invalid response. Every model must have a non-empty string ID.')
    }
    return [...new Set<string>(result.data.map((model) => model.id.trim()))].sort()
}

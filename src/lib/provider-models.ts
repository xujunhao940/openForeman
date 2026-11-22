export type Provider = {
    id: string
    name: string
    preset: 'openai' | 'anthropic' | 'custom'
    baseUrl: string
    models: string[]
}

export type ModelPreference = {providerId: string; enabled: boolean}
export type Model = {id: string; providers: Provider[]; providerId: string; enabled: boolean}

// The model endpoint usually exposes IDs only. Keep this conservative so text-capable
// chat models remain selectable while dedicated non-text models are disabled.
const nonTextModelPatterns = [
    /(?:^|[-_./])(embedding|embeddings|embed|rerank|reranker|cross[-_]?encoder)(?:[-_./]|$)/i,
    /(?:^|[-_./])(whisper|audio|speech|tts|text[-_]?to[-_]?speech|stt|asr)(?:[-_./]|$)/i,
    /(?:^|[-_./])(image|images|vision[-_]?only|text[-_]?to[-_]?image|image[-_]?generation)(?:[-_./]|$)/i,
    /(?:^|[-_./])(video|text[-_]?to[-_]?video)(?:[-_./]|$)/i,
    /(?:^|[-_./])(moderation|moderations|classifier|classification)(?:[-_./]|$)/i,
]

export function isTextModel(id: string): boolean {
    return !nonTextModelPatterns.some((pattern) => pattern.test(id))
}

export function modelsUnion(providers: Provider[], preferences: Record<string, ModelPreference>): Model[] {
    const models = new Map<string, Provider[]>()
    for (const provider of providers) {
        for (const id of new Set(provider.models)) models.set(id, [...(models.get(id) ?? []), provider])
    }
    return Array.from(models, ([id, available]) => ({
        id,
        providers: available,
        providerId: available.find((provider) => provider.id === preferences[id]?.providerId)?.id ?? available[0].id,
        enabled: isTextModel(id) && (preferences[id]?.enabled ?? true),
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

export async function requestModels(baseUrl: string, apiKey: string, preset: Provider['preset'] = 'custom'): Promise<string[]> {
    const headers = preset === 'anthropic'
        ? {'x-api-key': apiKey, 'anthropic-version': '2023-06-01'}
        : apiKey ? {Authorization: `Bearer ${apiKey}`} : {}
    const response = await fetch(modelsEndpoint(baseUrl), {
        headers,
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

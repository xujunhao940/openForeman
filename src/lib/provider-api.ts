import {requestModels} from './provider-models'

const sessionKeys = new Map<string, string>()
export async function readProviderKey(id: string): Promise<string> {
    return window.providersAPI ? window.providersAPI.readKey(id) : sessionKeys.get(id) ?? ''
}
export async function saveProviderKey(id: string, key: string): Promise<void> {
    if (window.providersAPI) await window.providersAPI.saveKey(id, key)
    else sessionKeys.set(id, key)
}
export async function deleteProviderKey(id: string): Promise<void> {
    if (window.providersAPI) await window.providersAPI.deleteKey(id)
    else sessionKeys.delete(id)
}
export async function fetchProviderModels(id: string, baseUrl: string): Promise<string[]> {
    return window.providersAPI ? window.providersAPI.fetchModels(id, baseUrl) : requestModels(baseUrl, await readProviderKey(id))
}

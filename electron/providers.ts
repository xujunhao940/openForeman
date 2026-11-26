import {app, ipcMain, safeStorage} from 'electron'
import {readFile, mkdir, rename, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {requestModels} from '../src/lib/provider-models'

const credentialPath = () => path.join(app.getPath('userData'), 'provider-credentials.json')
let writes = Promise.resolve()

export class ProviderCredentialError extends Error {}

function validateId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid provider ID.')
}

async function readCredentials(): Promise<Record<string, string>> {
    try { return JSON.parse(await readFile(credentialPath(), 'utf8')) }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
        throw new Error('Could not read stored provider credentials.')
    }
}

function changeCredentials(id: string, encrypted?: string) {
    const operation = writes.then(async () => {
        const credentials = await readCredentials()
        if (encrypted === undefined) delete credentials[id]
        else credentials[id] = encrypted
        await mkdir(path.dirname(credentialPath()), {recursive: true})
        await writeFile(`${credentialPath()}.tmp`, JSON.stringify(credentials), {mode: 0o600})
        await rename(`${credentialPath()}.tmp`, credentialPath())
    })
    writes = operation.catch(() => {})
    return operation
}

export async function readKey(id: string) {
    await writes
    const encrypted = (await readCredentials())[id]
    if (!encrypted) return ''
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
        throw new ProviderCredentialError('System credential storage is unavailable. Unlock it and try again.')
    }
    try {
        const {result} = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
        return result
    } catch {
        throw new ProviderCredentialError('Could not unlock the saved API key. Re-enter it in Settings → Providers.')
    }
}

export function registerProviderHandlers() {
    ipcMain.handle('providers:read-key', (_event, id: unknown) => {
        validateId(id)
        return readKey(id)
    })
    ipcMain.handle('providers:save-key', async (_event, id: unknown, key: unknown) => {
        validateId(id)
        if (typeof key !== 'string') throw new Error('Invalid API key.')
        if (!key) return changeCredentials(id)
        if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('System credential encryption is unavailable.')
        const encrypted = await safeStorage.encryptStringAsync(key)
        return changeCredentials(id, encrypted.toString('base64'))
    })
    ipcMain.handle('providers:delete-key', (_event, id: unknown) => {
        validateId(id)
        return changeCredentials(id)
    })
    ipcMain.handle('providers:fetch-models', async (_event, id: unknown, baseUrl: unknown, preset: unknown) => {
        validateId(id)
        if (typeof baseUrl !== 'string') throw new Error('Invalid base URL.')
        if (preset !== 'openai' && preset !== 'anthropic' && preset !== 'custom') throw new Error('Invalid provider preset.')
        return requestModels(baseUrl, await readKey(id), preset)
    })
}

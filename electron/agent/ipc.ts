import {app, BrowserWindow, dialog, ipcMain} from 'electron'
import path from 'node:path'
import {ProviderCredentialError, readKey} from '../providers'
import {AgentRuntime} from './runtime'
import {serveAgent} from './http'
import {saveUploads} from './uploads'
import type {AgentConfig, QueueAction, RunRequest} from '../../shared/agent'
import {SleepController} from '../power'
import type {SleepMode} from '../../shared/power'

export function registerAgentHandlers() {
    const sleepController = new SleepController()
    const runtime = new AgentRuntime(path.join(app.getPath('userData'), 'agent'), event => {
        sleepController.handleAgentEvent(event)
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('agent:event', event)
    }, readKey)
    ipcMain.handle('power:supported', () => sleepController.supported())
    ipcMain.handle('power:set-mode', (_event, mode: SleepMode) => sleepController.setMode(mode))
    ipcMain.handle('agent:config', () => runtime.config())
    ipcMain.handle('agent:upload', (_event, cwd, files) => saveUploads(cwd, files))
    ipcMain.handle('agent:replay', () => runtime.replay())
    ipcMain.handle('agent:save-config', (_event, config: AgentConfig) => runtime.saveConfig(config))
    ipcMain.handle('agent:start', (_event, request: RunRequest) => runtime.start(request))
    ipcMain.handle('agent:identify-feedforward', async (_event, text: string, provider, modelId: string) => {
        try {
            return await runtime.identifyFeedforward(text, provider, modelId)
        } catch (error) {
            if (error instanceof ProviderCredentialError) return {credentialError: error.message}
            throw error
        }
    })
    ipcMain.handle('agent:stop', (_event, chatId: string) => runtime.stop(chatId))
    ipcMain.handle('agent:approve', (_event, id: string, approved: boolean) => runtime.approve(id, approved))
    ipcMain.handle('agent:enqueue', (_event, chatId: string, text: string) => runtime.enqueue(chatId, text))
    ipcMain.handle('agent:update-queue', (_event, chatId: string, id: string, action: QueueAction) => runtime.updateQueue(chatId, id, action))
    ipcMain.handle('agent:workspace', (_event, cwd: string) => runtime.workspace(cwd))
    ipcMain.handle('agent:save-memory', (_event, cwd: string, text: string) => runtime.saveMemory(cwd, text))
    ipcMain.handle('agent:restore', (_event, cwd: string, id: string) => runtime.restore(cwd, id))
    ipcMain.handle('agent:diff', (_event, cwd: string) => runtime.diff(cwd))
    ipcMain.handle('agent:review', (_event, cwd: string) => runtime.review(cwd))
    ipcMain.handle('agent:import-skill', (_event, directory: string) => runtime.importSkill(directory))
    ipcMain.handle('agent:select-directory', async () => {
        const result = await dialog.showOpenDialog({properties: ['openDirectory']})
        return result.canceled ? null : result.filePaths[0]
    })
    app.on('before-quit', () => { sleepController.dispose(); void runtime.dispose() })
    if (process.env.FOREMAN_API_PORT !== undefined) {
        void serveAgent(runtime, Number(process.env.FOREMAN_API_PORT), process.env.FOREMAN_API_TOKEN ?? '').then(({server, port}) => {
            console.info(`Foreman API listening on http://127.0.0.1:${port}`)
            app.once('before-quit', () => server.close())
        }).catch(error => {
            console.error('Foreman API failed to start', error)
            app.quit()
        })
    }
    return runtime
}

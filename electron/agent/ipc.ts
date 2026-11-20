import {app, BrowserWindow, dialog, ipcMain} from 'electron'
import path from 'node:path'
import {readKey} from '../providers'
import {AgentRuntime} from './runtime'
import type {AgentConfig, QueueAction, RunRequest} from '../../shared/agent'

export function registerAgentHandlers() {
    const runtime = new AgentRuntime(path.join(app.getPath('userData'), 'agent'), event => {
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('agent:event', event)
    }, readKey)
    ipcMain.handle('agent:config', () => runtime.config())
    ipcMain.handle('agent:replay', () => runtime.replay())
    ipcMain.handle('agent:save-config', (_event, config: AgentConfig) => runtime.saveConfig(config))
    ipcMain.handle('agent:start', (_event, request: RunRequest) => runtime.start(request))
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
    app.on('before-quit', () => { void runtime.dispose() })
    return runtime
}

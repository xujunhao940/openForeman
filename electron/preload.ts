import { ipcRenderer, contextBridge } from 'electron'
import type {AgentAPI, AgentEvent} from '../shared/agent'
import type {MenuAPI, MenuCommand} from '../shared/menu'
import type {PowerAPI} from '../shared/power'
import type {BackgroundTasksAPI, BackgroundTask} from '../shared/background-tasks'

if (process.platform === 'darwin') {
  const menuAPI: MenuAPI = {
    subscribe: listener => {
      const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand) => listener(command)
      ipcRenderer.on('app-menu:command', handler)
      ipcRenderer.send('app-menu:ready')
      return () => ipcRenderer.removeListener('app-menu:command', handler)
    },
  }
  contextBridge.exposeInMainWorld('menuAPI', menuAPI)
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld('providersAPI', {
  readKey: (id: string) => ipcRenderer.invoke('providers:read-key', id),
  saveKey: (id: string, key: string) => ipcRenderer.invoke('providers:save-key', id, key),
  deleteKey: (id: string) => ipcRenderer.invoke('providers:delete-key', id),
  fetchModels: (id: string, baseUrl: string, preset: 'openai' | 'anthropic' | 'custom') => ipcRenderer.invoke('providers:fetch-models', id, baseUrl, preset),
})

const powerAPI: PowerAPI = {
  supported: () => ipcRenderer.invoke('power:supported'),
  setMode: mode => ipcRenderer.invoke('power:set-mode', mode),
}
contextBridge.exposeInMainWorld('powerAPI', powerAPI)

const backgroundTasksAPI: BackgroundTasksAPI = {
  list: () => ipcRenderer.invoke('background-task:list'),
  add: request => ipcRenderer.invoke('background-task:add', request),
  start: id => ipcRenderer.invoke('background-task:start', id),
  stop: id => ipcRenderer.invoke('background-task:stop', id),
  remove: id => ipcRenderer.invoke('background-task:remove', id),
  subscribe: listener => {
    const handler = (_event: Electron.IpcRendererEvent, task: BackgroundTask) => listener(task)
    ipcRenderer.on('background-task:event', handler)
    return () => ipcRenderer.removeListener('background-task:event', handler)
  },
}
contextBridge.exposeInMainWorld('backgroundTasksAPI', backgroundTasksAPI)

const agentAPI: AgentAPI = {
  config: () => ipcRenderer.invoke('agent:config'),
  saveConfig: config => ipcRenderer.invoke('agent:save-config', config),
  start: request => ipcRenderer.invoke('agent:start', request),
  stop: chatId => ipcRenderer.invoke('agent:stop', chatId),
  approve: (id, approved) => ipcRenderer.invoke('agent:approve', id, approved),
  enqueue: (chatId, text) => ipcRenderer.invoke('agent:enqueue', chatId, text),
  updateQueue: (chatId, id, action) => ipcRenderer.invoke('agent:update-queue', chatId, id, action),
  workspace: cwd => ipcRenderer.invoke('agent:workspace', cwd),
  saveMemory: (cwd, text) => ipcRenderer.invoke('agent:save-memory', cwd, text),
  restore: (cwd, id) => ipcRenderer.invoke('agent:restore', cwd, id),
  diff: cwd => ipcRenderer.invoke('agent:diff', cwd),
  review: cwd => ipcRenderer.invoke('agent:review', cwd),
  importSkill: directory => ipcRenderer.invoke('agent:import-skill', directory),
  selectDirectory: () => ipcRenderer.invoke('agent:select-directory'),
  replay: () => ipcRenderer.invoke('agent:replay'),
  subscribe: listener => {
    const handler = (_event: Electron.IpcRendererEvent, event: AgentEvent) => listener(event)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },
}
contextBridge.exposeInMainWorld('agentAPI', agentAPI)

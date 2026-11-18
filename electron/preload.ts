import { ipcRenderer, contextBridge } from 'electron'
import type {AgentAPI, AgentEvent} from '../shared/agent'

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
  fetchModels: (id: string, baseUrl: string) => ipcRenderer.invoke('providers:fetch-models', id, baseUrl),
})

const agentAPI: AgentAPI = {
  config: () => ipcRenderer.invoke('agent:config'),
  saveConfig: config => ipcRenderer.invoke('agent:save-config', config),
  start: request => ipcRenderer.invoke('agent:start', request),
  stop: chatId => ipcRenderer.invoke('agent:stop', chatId),
  approve: (id, approved) => ipcRenderer.invoke('agent:approve', id, approved),
  enqueue: (chatId, text, delivery) => ipcRenderer.invoke('agent:enqueue', chatId, text, delivery),
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

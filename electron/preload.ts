import { ipcRenderer, contextBridge } from 'electron'

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

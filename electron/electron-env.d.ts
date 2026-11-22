/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  agentAPI?: import('../shared/agent').AgentAPI
  menuAPI?: import('../shared/menu').MenuAPI
  powerAPI?: import('../shared/power').PowerAPI
  backgroundTasksAPI?: import('../shared/background-tasks').BackgroundTasksAPI
  ipcRenderer: import('electron').IpcRenderer
  providersAPI?: {
    readKey: (id: string) => Promise<string>
    saveKey: (id: string, key: string) => Promise<void>
    deleteKey: (id: string) => Promise<void>
    fetchModels: (id: string, baseUrl: string) => Promise<string[]>
  }
}

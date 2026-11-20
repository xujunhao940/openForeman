import { app, BrowserWindow, screen } from 'electron'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {registerProviderHandlers} from './providers'
import {registerAgentHandlers} from './agent/ipc'
import {installMacMenu, macAppName} from './menu'
import type {MenuCommand} from '../shared/menu'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

const iconDirectory = path.join(process.env.APP_ROOT, 'icons')
const appIcon = path.join(iconDirectory, 'Foreman.png')

if (process.platform === 'darwin') {
  // Keep existing projects, credentials and browser storage under the original profile.
  const userData = app.getPath('userData')
  mkdirSync(userData, {recursive: true})
  app.setPath('userData', userData)
  app.setName(macAppName)
}

let win: BrowserWindow | null = null
let menuReady: Promise<boolean>

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width: Math.min(850, width),
    height: Math.min(650, height),
    icon: appIcon,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  const window = win
  window.once('closed', () => {
    win = null
  })
  if (process.platform === 'darwin') {
    menuReady = new Promise(resolve => {
      window.webContents.ipc.once('app-menu:ready', () => resolve(true))
      window.once('closed', () => resolve(false))
    })
  }

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
  return window
}

async function dispatchMenuCommand(command: MenuCommand) {
  const window = win ?? createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  if (await menuReady && !window.isDestroyed()) {
    window.webContents.send('app-menu:command', command)
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    if (!app.isPackaged) {
      app.dock.setIcon(path.join(iconDirectory, 'Foreman-mac.png'))
    }
    installMacMenu(iconDirectory, dispatchMenuCommand)
  }
  registerProviderHandlers()
  registerAgentHandlers()
  createWindow()
})

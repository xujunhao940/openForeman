import { app, BrowserView, BrowserWindow, dialog, nativeTheme, screen, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {registerProviderHandlers} from './providers'
import {registerAgentHandlers} from './agent/ipc'
import {registerBackgroundTaskHandlers} from './background-tasks'
import {installMacMenu, macAppName} from './menu'
import type {MenuCommand} from '../shared/menu'
import {homepage} from '../package.json'

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
  const windowWidth = Math.min(1000, width)
  const windowHeight = Math.min(800, height)
  win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    icon: appIcon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#f7f7f5',
    show: true,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  const window = win
  const openWebLink = (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(console.error)
  }
  window.webContents.setWindowOpenHandler(({url}) => {
    openWebLink(url)
    return {action: 'deny'}
  })
  window.webContents.on('will-navigate', (event, url) => {
    const page = new URL(window.webContents.getURL())
    const target = new URL(url)
    if (target.origin === page.origin && target.protocol === page.protocol) return
    event.preventDefault()
    openWebLink(url)
  })
  const loadingView = new BrowserView()
  window.setBrowserView(loadingView)
  loadingView.setBounds({x: 0, y: 0, width: windowWidth, height: windowHeight})
  loadingView.setAutoResize({width: true, height: true})
  loadingView.webContents.once('dom-ready', () => window.show())
  loadingView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) console.error(`Startup animation failed to load ${validatedURL} (${errorCode}): ${errorDescription}`)
    window.show()
  })
  window.once('ready-to-show', () => {
    window.show()
    setTimeout(() => {
      if (!window.isDestroyed() && window.getBrowserView() === loadingView) window.removeBrowserView(loadingView)
    }, 500)
  })
  window.once('closed', () => { win = null })
  window.webContents.ipc.handle('app:open-homepage', () => shell.openExternal(homepage))
  window.webContents.ipc.handle('app:save-chromium-notices', async () => {
    const filename = 'LICENSES.chromium.html'
    const source = VITE_DEV_SERVER_URL
      ? path.join(app.getAppPath(), 'node_modules', 'electron', 'dist', filename)
      : path.join(RENDERER_DIST, filename)
    const {canceled, filePath} = await dialog.showSaveDialog(window, {defaultPath: filename})
    if (!canceled && filePath) await writeFile(filePath, await readFile(source))
  })
  if (process.platform === 'darwin') {
    menuReady = new Promise(resolve => {
      window.webContents.ipc.once('app-menu:ready', () => resolve(true))
      window.once('closed', () => resolve(false))
    })
  }

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    console.error(`Main window failed to load ${validatedURL} (${errorCode}): ${errorDescription}`)
    window.show()
  })
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('main-process-message', (new Date).toLocaleString())
  })
  if (VITE_DEV_SERVER_URL) void loadingView.webContents.loadURL(`${VITE_DEV_SERVER_URL}/loading.html`)
  else void loadingView.webContents.loadFile(path.join(RENDERER_DIST, 'loading.html'))
  if (VITE_DEV_SERVER_URL) void window.loadURL(VITE_DEV_SERVER_URL)
  else void window.loadFile(path.join(RENDERER_DIST, 'index.html'))
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
  registerBackgroundTaskHandlers()
  createWindow()
})

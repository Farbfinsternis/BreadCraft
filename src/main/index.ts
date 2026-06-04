import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import {
  chooseWorkspaceDir,
  defaultWorkspaceRoot,
  initWorkspace,
  workspaceStatus
} from './workspace'
import {
  createFile,
  createProject,
  createTempProject,
  listAssets,
  openProject,
  openProjectViaDialog,
  readAsset,
  recentProjects,
  resolveStartupProject,
  saveFile,
  writeAsset
} from './project'
import { checkVicePath, chooseVicePath, readSettings, writeSettings } from './settings'
import { resolveLanguage } from './config'
import { buildAndRun } from './build'
import { savedWindowOptions, shouldStartMaximized, trackWindowState } from './window-state'
import type { AssetKind, GraphicsMode, SettingsPatch } from '../shared/ipc'

function registerIpc(): void {
  // First-run / workspace handshake. The renderer asks for status on boot and,
  // if setup is needed, drives the onboarding dialog through these channels.
  ipcMain.handle('workspace:status', () => workspaceStatus())
  ipcMain.handle('workspace:defaultRoot', () => defaultWorkspaceRoot())
  ipcMain.handle('workspace:choose', async (event, defaultPath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    return chooseWorkspaceDir(window, defaultPath)
  })
  ipcMain.handle('workspace:init', (_event, root: string) => initWorkspace(root))

  // Project / file layer.
  ipcMain.handle('project:startup', () => resolveStartupProject())
  ipcMain.handle('project:recents', () => recentProjects())
  ipcMain.handle('project:createTemp', () => createTempProject())
  ipcMain.handle(
    'project:create',
    (_event, name: string, graphicsMode: GraphicsMode, withBoilerplate: boolean) =>
      createProject(name, graphicsMode, withBoilerplate)
  )
  ipcMain.handle('project:open', (_event, breadPath: string) => openProject(breadPath))
  ipcMain.handle('project:openDialog', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    return openProjectViaDialog(window)
  })
  ipcMain.handle('project:saveFile', (_event, dir: string, rel: string, content: string) =>
    saveFile(dir, rel, content)
  )
  ipcMain.handle('project:createFile', (_event, dir: string, name: string) =>
    createFile(dir, name)
  )

  // Asset IO (ASSET_IO.md): generic project-bound read/write of asset files,
  // keeping the .bread manifest in sync. One flow for palette/charset/tilemap.
  ipcMain.handle('assets:read', (_event, dir: string, rel: string) => readAsset(dir, rel))
  ipcMain.handle('assets:list', (_event, dir: string) => listAssets(dir))
  ipcMain.handle(
    'assets:write',
    (_event, dir: string, kind: AssetKind, rel: string, content: string) =>
      writeAsset(dir, kind, rel, content)
  )

  // Global (per-machine) settings: read, write a patch, validate/browse VICE path.
  ipcMain.handle('settings:read', () => readSettings())
  // Effective UI language: persisted choice, or derived from the OS on first run
  // (German ⇒ 'de', anything else / undetectable ⇒ 'en') and then persisted.
  ipcMain.handle('settings:language', () => resolveLanguage())
  ipcMain.handle('settings:write', (_event, patch: SettingsPatch) => writeSettings(patch))
  ipcMain.handle('settings:checkVice', (_event, path: string) => checkVicePath(path))
  ipcMain.handle('settings:browseVice', async (event, current: string | null) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    return chooseVicePath(window, current)
  })

  // Build & Run: transpile the given source, compile with bundled cc65, run in VICE.
  ipcMain.handle('build:run', (_event, source: string, projectDir: string) =>
    buildAndRun(source, projectDir)
  )
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    ...savedWindowOptions(),
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#05080F',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Restore a maximized session before showing, so it appears already maximized.
  if (shouldStartMaximized()) mainWindow.maximize()
  trackWindowState(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev; load the built file in prod.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

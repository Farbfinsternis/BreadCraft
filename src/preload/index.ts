import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AssetKind,
  BreadAssets,
  BuildResult,
  Locale,
  OpenedProject,
  ProjectFile,
  RecentProject,
  SettingsPatch,
  VicePathCheck,
  WorkspaceStatus
} from '../shared/ipc'

export type {
  AppConfig,
  AssetKind,
  BreadAssets,
  BuildResult,
  Locale,
  OpenedProject,
  ProjectFile,
  RecentProject,
  SettingsPatch,
  VicePathCheck,
  WorkspaceStatus
}

// Safe, typed surface over the main-process services. Grows as the IDE needs
// more (project load/save, build pipeline, emulator control).
const api = {
  platform: process.platform,
  workspace: {
    status: (): Promise<WorkspaceStatus> => ipcRenderer.invoke('workspace:status'),
    defaultRoot: (): Promise<string> => ipcRenderer.invoke('workspace:defaultRoot'),
    choose: (defaultPath: string): Promise<string | null> =>
      ipcRenderer.invoke('workspace:choose', defaultPath),
    init: (root: string): Promise<AppConfig> => ipcRenderer.invoke('workspace:init', root)
  },
  project: {
    startup: (): Promise<OpenedProject | null> => ipcRenderer.invoke('project:startup'),
    recents: (): Promise<RecentProject[]> => ipcRenderer.invoke('project:recents'),
    createTemp: (): Promise<OpenedProject> => ipcRenderer.invoke('project:createTemp'),
    create: (name: string): Promise<OpenedProject> =>
      ipcRenderer.invoke('project:create', name),
    open: (breadPath: string): Promise<OpenedProject> =>
      ipcRenderer.invoke('project:open', breadPath),
    openDialog: (): Promise<OpenedProject | null> =>
      ipcRenderer.invoke('project:openDialog'),
    saveFile: (dir: string, rel: string, content: string): Promise<void> =>
      ipcRenderer.invoke('project:saveFile', dir, rel, content),
    createFile: (dir: string, name: string): Promise<ProjectFile> =>
      ipcRenderer.invoke('project:createFile', dir, name)
  },
  assets: {
    read: (dir: string, rel: string): Promise<string | null> =>
      ipcRenderer.invoke('assets:read', dir, rel),
    list: (dir: string): Promise<BreadAssets> => ipcRenderer.invoke('assets:list', dir),
    write: (dir: string, kind: AssetKind, rel: string, content: string): Promise<string> =>
      ipcRenderer.invoke('assets:write', dir, kind, rel, content)
  },
  settings: {
    read: (): Promise<AppConfig> => ipcRenderer.invoke('settings:read'),
    language: (): Promise<Locale> => ipcRenderer.invoke('settings:language'),
    write: (patch: SettingsPatch): Promise<AppConfig> =>
      ipcRenderer.invoke('settings:write', patch),
    checkVice: (path: string): Promise<VicePathCheck> =>
      ipcRenderer.invoke('settings:checkVice', path),
    browseVice: (current: string | null): Promise<string | null> =>
      ipcRenderer.invoke('settings:browseVice', current)
  },
  build: {
    run: (source: string, projectDir: string): Promise<BuildResult> =>
      ipcRenderer.invoke('build:run', source, projectDir)
  }
}

export type BreadCraftApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('breadcraft', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when context isolation is off)
  window.breadcraft = api
}

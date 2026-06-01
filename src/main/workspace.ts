import { app, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { readConfig, writeConfig, type AppConfig } from './config'

export const TEMP_DIRNAME = 'temp'
export const PROJECTS_DIRNAME = 'projects'

/** Suggested default workspace location: <Documents>/BreadCraft. */
export function defaultWorkspaceRoot(): string {
  return join(app.getPath('documents'), 'BreadCraft')
}

/** Ensure the workspace root and its /temp and /projects subfolders exist. */
export function ensureWorkspaceDirs(root: string): void {
  mkdirSync(join(root, TEMP_DIRNAME), { recursive: true })
  mkdirSync(join(root, PROJECTS_DIRNAME), { recursive: true })
}

/**
 * Finalize first-run setup: create the directory tree under `root` and persist
 * it as the workspace. Returns the updated config.
 */
export function initWorkspace(root: string): AppConfig {
  ensureWorkspaceDirs(root)
  return writeConfig({ workspaceRoot: root, initialized: true })
}

/** Native folder picker; returns the chosen absolute path or null if cancelled. */
export async function chooseWorkspaceDir(
  window: BrowserWindow,
  defaultPath: string
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title: 'BreadCraft-Arbeitsverzeichnis wählen',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  // The user picks a parent/target folder; the BreadCraft workspace lives there.
  return result.filePaths[0]
}

/**
 * On startup, report whether first-run onboarding is needed. Also self-heals: if
 * the config says initialized but the dir vanished, we re-flag for setup.
 */
export function workspaceStatus(): { needsSetup: boolean; config: AppConfig } {
  const config = readConfig()
  const ok = config.initialized && !!config.workspaceRoot && existsSync(config.workspaceRoot)
  return { needsSetup: !ok, config }
}

import { dialog, BrowserWindow } from 'electron'
import { basename } from 'path'
import { existsSync, statSync } from 'fs'
import { readConfig, writeConfig, type AppConfig } from './config'
import type { SettingsPatch, VicePathCheck } from '../shared/ipc'

// Global (per-machine) settings service. Reads/writes go through config.ts so the
// single userData JSON stays the one source of truth (memory: persist-everything).
// The Settings UI only ever sends a SettingsPatch — app-managed state (workspace,
// recents, lastProject) is not user-editable here.

/** Current global settings (full config; the UI reads only the editable fields). */
export function readSettings(): AppConfig {
  return readConfig()
}

/** Persist the editable settings fields. Returns the updated full config. */
export function writeSettings(patch: SettingsPatch): AppConfig {
  // Whitelist: only copy known editable keys, never trust the patch blindly.
  const clean: Partial<AppConfig> = {}
  if (patch.startupMode !== undefined) clean.startupMode = patch.startupMode
  if (patch.vicePath !== undefined) clean.vicePath = patch.vicePath || null
  if (patch.language !== undefined) clean.language = patch.language
  return writeConfig(clean)
}

/**
 * Validate a VICE executable path for the Settings UI feedback. We check that the
 * file exists and that its name looks like a VICE C64 emulator (x64sc / x64). We do
 * not execute it — that happens later when Build & Run actually launches it.
 */
export function checkVicePath(path: string): VicePathCheck {
  let exists = false
  try {
    exists = !!path && existsSync(path) && statSync(path).isFile()
  } catch {
    exists = false
  }
  const name = basename(path || '').toLowerCase()
  const looksLikeVice = /^x64(sc)?(\.exe)?$/.test(name)
  return { exists, looksLikeVice }
}

/** Native file picker for the VICE executable. Returns the path or null if cancelled. */
export async function chooseVicePath(
  window: BrowserWindow,
  current: string | null
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title: 'VICE-Emulator wählen (x64sc)',
    defaultPath: current ?? undefined,
    properties: ['openFile'],
    filters:
      process.platform === 'win32'
        ? [{ name: 'VICE (x64sc.exe)', extensions: ['exe'] }]
        : []
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { AppConfig, Locale } from '../shared/ipc'
import { DEFAULT_SETTINGS } from '../shared/ipc'

export type { AppConfig }

// App-wide settings persisted as JSON in Electron's userData dir. Deliberately
// dependency-free (no electron-store) — the shape is tiny and ours to control.
// Project rule: everything that can survive a restart is persisted
// (memory: breadcraft-persistence-rule).

const DEFAULT_CONFIG: AppConfig = {
  workspaceRoot: null,
  initialized: false,
  lastProjectBread: null,
  startupMode: DEFAULT_SETTINGS.startupMode,
  recentProjects: [],
  vicePath: null,
  language: null,
  windowState: null
}

/**
 * Derive the initial UI language from the OS locale (Electron's app.getLocale()
 * is the reliable source). Rule (memory: breadcraft-localization): only German
 * maps to 'de'; every other language — and an undetectable locale — maps to 'en'.
 */
export function deriveSystemLocale(): Locale {
  let raw = ''
  try {
    raw = app.getLocale() // e.g. "de", "de-DE", "en-US", "" if undetectable
  } catch {
    raw = ''
  }
  return raw.toLowerCase().startsWith('de') ? 'de' : 'en'
}

/**
 * The effective language: the persisted choice, or — on first run — the locale
 * derived from the OS, which is then persisted so the OS is consulted only once.
 */
export function resolveLanguage(): Locale {
  const cfg = readConfig()
  if (cfg.language) return cfg.language
  const derived = deriveSystemLocale()
  writeConfig({ language: derived })
  return derived
}

function configPath(): string {
  return join(app.getPath('userData'), 'breadcraft.config.json')
}

export function readConfig(): AppConfig {
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AppConfig>) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...readConfig(), ...patch }
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

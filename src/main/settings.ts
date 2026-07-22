import { app, dialog, shell, BrowserWindow } from 'electron'
import { basename, dirname, join, delimiter } from 'path'
import { existsSync, statSync, readdirSync, type Dirent } from 'fs'
import { readConfig, writeConfig, type AppConfig } from './config'
import type { SettingsPatch, VicePathCheck, ViceBrowseResult } from '../shared/ipc'

// The C64 binaries VICE ships. `x64sc` is the accurate one we want; `x64` is the
// legacy fast core (removed in newer VICE) — accepted only as a fallback.
const VICE_EXES = ['x64sc.exe', 'x64.exe'] as const

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

/**
 * Find a VICE C64 binary inside a folder the user picked. Looks in the folder itself,
 * its `bin/` subfolder (VICE's Windows layout), and any immediate subfolder — so
 * selecting `…\VICE` finds `…\VICE\bin\x64sc.exe`. Prefers `x64sc` over the legacy
 * `x64` across all of those. Returns the full executable path, or null if none is here.
 */
export function findViceExecutable(dir: string): string | null {
  const folders = [dir, join(dir, 'bin')]
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) folders.push(join(dir, entry.name))
    }
  } catch {
    // Unreadable directory → fall back to the base folders only.
  }
  // Prefer x64sc everywhere before considering x64 anywhere.
  for (const exe of VICE_EXES) {
    for (const folder of folders) {
      const p = join(folder, exe)
      try {
        if (existsSync(p) && statSync(p).isFile()) return p
      } catch {
        // ignore and keep looking
      }
    }
  }
  return null
}

/**
 * Native FOLDER picker for VICE (T4/T5): the user chooses the directory, BreadCraft
 * locates the executable — a newbie shouldn't have to know it's `x64sc.exe`. Returns
 * the resolved exe (`ok`), the chosen folder if nothing was found (`notfound`), or
 * `cancelled`.
 */
export async function browseForVice(
  window: BrowserWindow,
  current: string | null
): Promise<ViceBrowseResult> {
  const result = await dialog.showOpenDialog(window, {
    title: 'VICE-Ordner wählen',
    // `current` is an executable path; open its folder so re-browsing starts nearby.
    defaultPath: current ? dirname(current) : undefined,
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled', path: null }
  const dir = result.filePaths[0]
  const exe = findViceExecutable(dir)
  return exe ? { status: 'ok', path: exe } : { status: 'notfound', path: dir }
}

/** Depth-bounded walk for one executable name (files at each level first). */
function walkFor(dir: string, exe: string, depth: number): string | null {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === exe) return join(dir, e.name)
  }
  if (depth <= 0) return null
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = walkFor(join(dir, e.name), exe, depth - 1)
      if (hit) return hit
    }
  }
  return null
}

/** Search a whole tree (bounded depth) for a VICE binary, x64sc preferred over the
 *  legacy x64. Used after extracting the downloaded VICE, whose binary sits a couple
 *  of folders deep (e.g. `GTK3VICE-3.9-win64/bin/x64sc.exe`). */
export function findViceRecursive(dir: string, maxDepth = 5): string | null {
  for (const exe of VICE_EXES) {
    const hit = walkFor(dir, exe, maxDepth)
    if (hit) return hit
  }
  return null
}

// ---- Automatic detection (T1) -------------------------------------------------

/** True if `p` points at an existing VICE C64 binary file. */
function isViceFile(p: string): boolean {
  try {
    return (
      existsSync(p) &&
      statSync(p).isFile() &&
      (VICE_EXES as readonly string[]).includes(basename(p).toLowerCase())
    )
  } catch {
    return false
  }
}

/** The VICE binary sitting *directly* in `dir` (no subfolder scan), x64sc preferred. */
function viceExeInDir(dir: string): string | null {
  for (const exe of VICE_EXES) {
    const p = join(dir, exe)
    try {
      if (existsSync(p) && statSync(p).isFile()) return p
    } catch {
      // ignore and keep looking
    }
  }
  return null
}

/** The app-managed folder a downloaded VICE lands in (T3). Null if userData isn't
 *  available (e.g. outside a running Electron app, such as in unit tests). */
export function viceManagedDir(): string | null {
  try {
    return join(app.getPath('userData'), 'vice')
  } catch {
    return null
  }
}

/** The usual places a Windows VICE install sits: a `VICE` folder or a
 *  `GTK3VICE-*`/`SDL2VICE-*`/`WinVICE-*`/`vice*` folder under Program Files,
 *  LocalAppData or the C: root. Each is scanned incl. `bin/`. (The app-managed
 *  download dir is handled separately in detectVice — its binary sits deeper.) */
function candidateInstallDirs(): string[] {
  const dirs: string[] = []
  const roots = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env['LOCALAPPDATA'],
    'C:\\'
  ].filter((r): r is string => !!r)
  const prefixes = ['vice', 'gtk3vice', 'sdl2vice', 'winvice']
  for (const root of roots) {
    dirs.push(join(root, 'VICE'))
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (prefixes.some((p) => entry.name.toLowerCase().startsWith(p))) {
          dirs.push(join(root, entry.name))
        }
      }
    } catch {
      // root unreadable → skip its prefix scan
    }
  }
  return dirs
}

/**
 * Resolve the first VICE binary from an explicit search: PATH-style dirs (the binary
 * must sit directly inside) then install dirs (scanned incl. `bin/` + subfolders).
 * Pure over the filesystem — the caller supplies the dirs, so it is fully testable.
 */
export function resolveViceFrom(pathDirs: string[], installDirs: string[]): string | null {
  for (const dir of pathDirs) {
    const exe = viceExeInDir(dir)
    if (exe) return exe
  }
  for (const dir of installDirs) {
    const exe = findViceExecutable(dir)
    if (exe) return exe
  }
  return null
}

/**
 * Find a usable VICE without the user lifting a finger (T1). Order: the saved settings
 * path (if it still exists), then everything on `PATH`, then the managed download dir
 * and the usual Windows install spots. Returns the resolved x64sc/x64 path, or null on
 * a machine that has none.
 */
export function detectVice(): string | null {
  const saved = readConfig().vicePath
  if (saved && isViceFile(saved)) return saved
  // A VICE we downloaded ourselves lives a couple of folders deep in the managed dir —
  // recurse there (the depth-1 install scan below would miss it).
  const managed = viceManagedDir()
  if (managed) {
    const own = findViceRecursive(managed)
    if (own) return own
  }
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  return resolveViceFrom(pathDirs, candidateInstallDirs())
}

// ---- First-run onboarding (T2) ------------------------------------------------

/** The official VICE homepage. Until the in-app download (T3) lands, the onboarding's
 *  "download" action opens this in the browser; the user then links the folder. */
export const VICE_DOWNLOAD_URL = 'https://vice-emu.sourceforge.io/'

/** Remember that the first-run VICE onboarding has been shown, so it never auto-opens
 *  again (the user can still reach setup from the Run prompt or Settings). */
export function markViceOnboardingSeen(): void {
  writeConfig({ viceOnboardingSeen: true })
}

/** Open the official VICE download page in the user's browser (interim for T3). */
export function openViceDownloadPage(): Promise<void> {
  return shell.openExternal(VICE_DOWNLOAD_URL)
}

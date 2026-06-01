import { app, dialog, BrowserWindow } from 'electron'
import { join, basename, dirname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync
} from 'fs'
import { readConfig, writeConfig } from './config'
import { TEMP_DIRNAME, PROJECTS_DIRNAME } from './workspace'
import { DEFAULT_SETTINGS } from '../shared/ipc'
import type {
  AssetKind,
  BreadAssets,
  OpenedProject,
  ProjectFile,
  RecentProject
} from '../shared/ipc'

export type { OpenedProject, ProjectFile, AssetKind, BreadAssets }

// ---- .bread project format ----
// NOTE: the .bread *format* is officially "later/open" (SPRACHE.md §7.3). This
// is a deliberately minimal, forward-compatible JSON shape holding only what the
// file layer needs now: identity, the entry crumb, the crumb list, and an empty
// asset manifest placeholder. Extend (don't replace) as assets/manifest land.

export const BREAD_VERSION = '0.1.0'

export interface BreadProjectFile {
  $format: 'bread'
  $version: string
  name: string
  /** Entry crumb (the main.crumb with the frame loop), relative to project dir. */
  entry: string
  /** All crumb source files, relative to the project dir. */
  crumbs: string[]
  /** Asset manifest. See BreadAssets; older files may have a flat/empty map. */
  assets: BreadAssets
}

const EMPTY_ASSETS: BreadAssets = { palette: null, charsets: [], tilemaps: [] }

/** Coerce any persisted `assets` value (old `{}`/flat map, or the new shape) to
 *  a stable BreadAssets — forward/backward compatible (ASSET_IO.md §2). */
function normalizeAssets(raw: unknown): BreadAssets {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ASSETS }
  const a = raw as Partial<BreadAssets>
  return {
    palette: typeof a.palette === 'string' ? a.palette : null,
    charsets: Array.isArray(a.charsets) ? a.charsets.filter((s) => typeof s === 'string') : [],
    tilemaps: Array.isArray(a.tilemaps) ? a.tilemaps.filter((s) => typeof s === 'string') : []
  }
}

const SAMPLE_MAIN = `' main.crumb — neues BreadCraft-Projekt
' Setup-Phase

Graphics BITMAP, MULTICOLOR

' --- Frame-Schleife ---
While 1
    VWait
Wend
`

function workspaceRootOrThrow(): string {
  const root = readConfig().workspaceRoot
  if (!root) throw new Error('Kein Arbeitsverzeichnis eingerichtet.')
  return root
}

function breadPathFor(dir: string): string {
  return join(dir, `${basename(dir)}.bread`)
}

function writeBread(dir: string, data: BreadProjectFile): void {
  writeFileSync(breadPathFor(dir), JSON.stringify(data, null, 2), 'utf-8')
}

/** Read + parse a `.bread`, normalising the asset manifest to a stable shape. */
function readBread(dir: string): BreadProjectFile {
  const bread = JSON.parse(readFileSync(breadPathFor(dir), 'utf-8')) as BreadProjectFile
  bread.assets = normalizeAssets(bread.assets)
  return bread
}

function readProject(dir: string, temporary: boolean): OpenedProject {
  const breadPath = breadPathFor(dir)
  const bread = readBread(dir)

  const files: ProjectFile[] = bread.crumbs.map((rel) => ({
    rel,
    content: existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf-8') : ''
  }))

  // Remember this as the project to restore on next startup (every open funnels
  // through here). Persistence rule: survives restarts. Permanent projects also
  // enter the recent-projects list (temp projects are excluded — they expire).
  const patch: Parameters<typeof writeConfig>[0] = { lastProjectBread: breadPath }
  if (!temporary) {
    patch.recentProjects = pushRecent(breadPath, bread.name)
  }
  writeConfig(patch)

  return {
    dir,
    breadPath,
    name: bread.name,
    entry: bread.entry,
    files,
    temporary,
    assets: bread.assets
  }
}

/** Build the updated recent-projects list (newest first, de-duped, capped). */
function pushRecent(breadPath: string, name: string): RecentProject[] {
  const existing = readConfig().recentProjects.filter((r) => r.breadPath !== breadPath)
  const entry: RecentProject = { breadPath, name, openedAt: new Date().toISOString() }
  return [entry, ...existing].slice(0, DEFAULT_SETTINGS.recentProjectsLimit)
}

/** Recent permanent projects, newest first; prunes entries whose .bread is gone. */
export function recentProjects(): RecentProject[] {
  const recents = readConfig().recentProjects
  const alive = recents.filter((r) => existsSync(r.breadPath))
  if (alive.length !== recents.length) writeConfig({ recentProjects: alive })
  return alive
}

/** Scaffold a fresh project (dir + .bread + entry crumb) and return it opened. */
function scaffold(dir: string, name: string, temporary: boolean): OpenedProject {
  mkdirSync(dir, { recursive: true })
  const entry = 'main.crumb'
  writeFileSync(join(dir, entry), SAMPLE_MAIN, 'utf-8')
  writeBread(dir, {
    $format: 'bread',
    $version: BREAD_VERSION,
    name,
    entry,
    crumbs: [entry],
    assets: { ...EMPTY_ASSETS }
  })
  return readProject(dir, temporary)
}

/** Create a uniquely-named temporary project under <workspace>/temp. */
export function createTempProject(): OpenedProject {
  const tempRoot = join(workspaceRootOrThrow(), TEMP_DIRNAME)
  mkdirSync(tempRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `temp-${stamp}`
  return scaffold(join(tempRoot, name), name, true)
}

/** Open a project from its .bread file path. */
export function openProject(breadPath: string): OpenedProject {
  const dir = dirname(breadPath)
  const root = readConfig().workspaceRoot
  const temporary = !!root && dir.startsWith(join(root, TEMP_DIRNAME))
  return readProject(dir, temporary)
}

/**
 * Decide what to open at startup, honoring the startupMode setting:
 * - 'welcome' (default): open nothing → renderer shows the welcome page.
 * - 'last': restore the last opened project if its .bread still exists,
 *   otherwise fall back to a fresh temp project (the remembered one may be gone).
 */
export function resolveStartupProject(): OpenedProject | null {
  const config = readConfig()
  if (config.startupMode === 'welcome') return null

  const last = config.lastProjectBread
  if (last && existsSync(last)) {
    return openProject(last)
  }
  return createTempProject()
}

/** Native open dialog filtered to .bread files; opens the chosen project. */
export async function openProjectViaDialog(
  window: BrowserWindow
): Promise<OpenedProject | null> {
  const root = readConfig().workspaceRoot
  const result = await dialog.showOpenDialog(window, {
    title: 'BreadCraft-Projekt öffnen',
    defaultPath: root ? join(root, PROJECTS_DIRNAME) : app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'BreadCraft-Projekt', extensions: ['bread'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return openProject(result.filePaths[0])
}

/** Create a new permanent project under <workspace>/projects. */
export function createProject(name: string): OpenedProject {
  const projectsRoot = join(workspaceRootOrThrow(), PROJECTS_DIRNAME)
  mkdirSync(projectsRoot, { recursive: true })
  const safe = name.trim().replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'Projekt'
  let dir = join(projectsRoot, safe)
  let n = 2
  while (existsSync(dir)) dir = join(projectsRoot, `${safe} ${n++}`)
  return scaffold(dir, basename(dir), false)
}

/** Write a single crumb file's content back to disk. */
export function saveFile(dir: string, rel: string, content: string): void {
  const target = join(dir, rel)
  if (!existsSync(dir)) throw new Error('Projektverzeichnis fehlt.')
  writeFileSync(target, content, 'utf-8')
}

/** Add a new empty crumb file to a project and register it in the .bread. */
export function createFile(dir: string, rawName: string): ProjectFile {
  let rel = rawName.trim()
  if (!rel) throw new Error('Dateiname fehlt.')
  if (!rel.endsWith('.crumb')) rel += '.crumb'
  const target = join(dir, rel)
  if (existsSync(target)) throw new Error(`Datei existiert bereits: ${rel}`)

  writeFileSync(target, `' ${rel}\n`, 'utf-8')

  const bread = readBread(dir)
  if (!bread.crumbs.includes(rel)) {
    bread.crumbs.push(rel)
    writeBread(dir, bread)
  }
  return { rel, content: `' ${rel}\n` }
}

// ---- Asset IO (ASSET_IO.md §4) ----
// Generic, C64-agnostic disk IO for project assets (.palette/.petscii/.tilemap).
// The main process only reads/writes file CONTENT (text) and keeps the .bread
// manifest in sync; the MEANING of that content lives in the renderer. One flow
// for every asset kind (DRY — closes memory breadcraft-asset-io-debt).

/** Read an asset file's text content; null if it doesn't exist. */
export function readAsset(dir: string, rel: string): string | null {
  const target = join(dir, rel)
  if (!existsSync(target)) return null
  return readFileSync(target, 'utf-8')
}

/**
 * Write an asset file and register it in the `.bread` manifest under its kind.
 * Idempotent: re-saving the same asset just overwrites the file (the manifest
 * already lists it). Returns the manifest-relative path.
 */
export function writeAsset(dir: string, kind: AssetKind, rel: string, content: string): string {
  if (!existsSync(dir)) throw new Error('Projektverzeichnis fehlt.')
  writeFileSync(join(dir, rel), content, 'utf-8')

  const bread = readBread(dir)
  if (kind === 'palette') {
    bread.assets.palette = rel
  } else if (kind === 'charset') {
    if (!bread.assets.charsets.includes(rel)) bread.assets.charsets.push(rel)
  } else {
    if (!bread.assets.tilemaps.includes(rel)) bread.assets.tilemaps.push(rel)
  }
  writeBread(dir, bread)
  return rel
}

/** The asset manifest of a project (normalised). */
export function listAssets(dir: string): BreadAssets {
  return readBread(dir).assets
}

/** List existing .bread projects in <workspace>/projects (for a future picker). */
export function listProjects(): string[] {
  const root = readConfig().workspaceRoot
  if (!root) return []
  const projectsRoot = join(root, PROJECTS_DIRNAME)
  if (!existsSync(projectsRoot)) return []
  return readdirSync(projectsRoot)
    .map((d) => breadPathFor(join(projectsRoot, d)))
    .filter((p) => existsSync(p))
}

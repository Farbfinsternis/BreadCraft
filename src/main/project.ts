import { app, dialog, BrowserWindow } from 'electron'
import { join, basename, dirname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync
} from 'fs'
import { readConfig, writeConfig } from './config'
import { TEMP_DIRNAME, PROJECTS_DIRNAME } from './workspace'
import rawSsot from '../shared/breadcraft.lang.json'
import { DEFAULT_SETTINGS, DEFAULT_GRAPHICS_MODE, DEFAULT_REGION } from '../shared/ipc'
import { graphicsCommandFor } from '../shared/graphics-mode'
import type { Ssot } from '../shared/ssot-types'
import type {
  AssetKind,
  BreadAssets,
  GraphicsMode,
  Region,
  OpenedProject,
  ProjectFile,
  RecentProject,
  TreeNode
} from '../shared/ipc'

const SSOT = rawSsot as unknown as Ssot

export type { OpenedProject, ProjectFile, AssetKind, BreadAssets, GraphicsMode }

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
  /**
   * Project-wide graphics mode (IDE.md §2.1). Optional in the type for forward/
   * backward compatibility: old `.bread` files predate the field and read as the
   * DEFAULT_GRAPHICS_MODE (see normalizeGraphicsMode).
   */
  graphicsMode?: GraphicsMode
  /**
   * Target video standard (STAHL S5c). Optional for backward compatibility: old
   * `.bread` files predate it and read as DEFAULT_REGION (PAL) — see normalizeRegion.
   */
  region?: Region
  /** All crumb source files, relative to the project dir. */
  crumbs: string[]
  /** Asset manifest. See BreadAssets; older files may have a flat/empty map. */
  assets: BreadAssets
}

const EMPTY_ASSETS: BreadAssets = { palette: null, charsets: [], tilemaps: [], sprites: [] }

const GRAPHICS_MODES: readonly GraphicsMode[] = ['TEXT_HIRES', 'TEXT_MULTICOLOR', 'BITMAP_MULTICOLOR']

/** Coerce any persisted `graphicsMode` to a valid mode; old/invalid files → default. */
function normalizeGraphicsMode(raw: unknown): GraphicsMode {
  return GRAPHICS_MODES.includes(raw as GraphicsMode) ? (raw as GraphicsMode) : DEFAULT_GRAPHICS_MODE
}

const REGIONS: readonly Region[] = ['PAL', 'NTSC']

/** Coerce any persisted `region` to a valid one; old/invalid files → default (PAL). */
function normalizeRegion(raw: unknown): Region {
  return REGIONS.includes(raw as Region) ? (raw as Region) : DEFAULT_REGION
}

/** The persisted target region for a project dir (STAHL S5c), read from its `.bread`
 *  and normalized (old/missing → PAL). The build path uses it to pick the PERF budget
 *  and the VICE launch flag, reading straight from disk so it can't drift from what's saved. */
export function projectRegion(dir: string): Region {
  return normalizeRegion(readBread(dir).region)
}

/** Coerce any persisted `assets` value (old `{}`/flat map, or the new shape) to
 *  a stable BreadAssets — forward/backward compatible (ASSET_IO.md §2). */
function normalizeAssets(raw: unknown): BreadAssets {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ASSETS }
  const a = raw as Partial<BreadAssets>
  return {
    palette: typeof a.palette === 'string' ? a.palette : null,
    charsets: Array.isArray(a.charsets) ? a.charsets.filter((s) => typeof s === 'string') : [],
    tilemaps: Array.isArray(a.tilemaps) ? a.tilemaps.filter((s) => typeof s === 'string') : [],
    sprites: Array.isArray(a.sprites) ? a.sprites.filter((s) => typeof s === 'string') : []
  }
}

/** The starter main.crumb — its `Graphics …` line reflects the project's mode
 *  (derived from the SSOT, never hardcoded; IDE.md §2.1, M1.T4). */
export function sampleMain(graphicsMode: GraphicsMode): string {
  return `; main.crumb — neues BreadCraft-Projekt
; Setup-Phase

${graphicsCommandFor(SSOT, graphicsMode)}

; --- Frame-Schleife ---
While 1
    VWait
Wend
`
}

/** The bare main.crumb when boilerplate is opted out: just the mode's `Graphics …`
 *  line so the project still reflects its mode and transpiles, nothing more. */
function bareMain(graphicsMode: GraphicsMode): string {
  return `${graphicsCommandFor(SSOT, graphicsMode)}\n`
}

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

/** Read + parse a `.bread`, normalising the asset manifest + graphics mode + region. */
function readBread(dir: string): BreadProjectFile {
  const bread = JSON.parse(readFileSync(breadPathFor(dir), 'utf-8')) as BreadProjectFile
  bread.assets = normalizeAssets(bread.assets)
  bread.graphicsMode = normalizeGraphicsMode(bread.graphicsMode)
  bread.region = normalizeRegion(bread.region)
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
    graphicsMode: normalizeGraphicsMode(bread.graphicsMode),
    region: normalizeRegion(bread.region),
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

/** Scaffold a fresh project (dir + .bread + entry crumb) and return it opened.
 *  `withBoilerplate` (default true, A.8) writes the commented frame-loop starter;
 *  off writes a bare `Graphics …` stub. */
function scaffold(
  dir: string,
  name: string,
  temporary: boolean,
  graphicsMode: GraphicsMode = DEFAULT_GRAPHICS_MODE,
  withBoilerplate = true,
  region: Region = DEFAULT_REGION
): OpenedProject {
  mkdirSync(dir, { recursive: true })
  const entry = 'main.crumb'
  const content = withBoilerplate ? sampleMain(graphicsMode) : bareMain(graphicsMode)
  writeFileSync(join(dir, entry), content, 'utf-8')
  writeBread(dir, {
    $format: 'bread',
    $version: BREAD_VERSION,
    name,
    entry,
    graphicsMode,
    region,
    crumbs: [entry],
    assets: { ...EMPTY_ASSETS }
  })
  return readProject(dir, temporary)
}

/** Create a uniquely-named temporary project under <workspace>/temp. A temp
 *  project asks no questions (memory breadcraft-ide-architecture), so the graphics
 *  mode is the silent Phase-1 default (TEXT_MULTICOLOR) — passed EXPLICITLY here so
 *  the choice is visible and not coupled to scaffold's parameter default. */
export function createTempProject(): OpenedProject {
  const tempRoot = join(workspaceRootOrThrow(), TEMP_DIRNAME)
  mkdirSync(tempRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `temp-${stamp}`
  return scaffold(join(tempRoot, name), name, true, DEFAULT_GRAPHICS_MODE)
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

/** Create a new permanent project under <workspace>/projects. The graphics mode
 *  (chosen in the New-Project dialog, M1.T6) is persisted into the `.bread`; the
 *  boilerplate flag (default on, A.8) chooses starter vs. bare main.crumb. */
export function createProject(
  name: string,
  graphicsMode: GraphicsMode = DEFAULT_GRAPHICS_MODE,
  withBoilerplate = true,
  region: Region = DEFAULT_REGION
): OpenedProject {
  const projectsRoot = join(workspaceRootOrThrow(), PROJECTS_DIRNAME)
  mkdirSync(projectsRoot, { recursive: true })
  // Display name vs. folder name: the user types a free name ("Into The Deep"); the
  // folder + .bread are a filesystem-safe slug ("into-the-deep"), so paths never carry
  // spaces/odd chars into the toolchain (cc65/VICE/Git). The display name is kept in
  // the manifest. (BreadCraft doctrine: think pretty, translate to something machinable.)
  const display = name.trim() || 'Projekt'
  const slug = slugify(display)
  let dir = join(projectsRoot, slug)
  let n = 2
  while (existsSync(dir)) dir = join(projectsRoot, `${slug}-${n++}`)
  return scaffold(
    dir,
    display,
    false,
    normalizeGraphicsMode(graphicsMode),
    withBoilerplate,
    normalizeRegion(region)
  )
}

/** A filesystem-safe project slug: lowercase, spaces/underscores → hyphens, drop any
 *  other non-[a-z0-9-] char, collapse and trim hyphens. Empty result → 'projekt'. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'projekt'
}

/** Write a single crumb file's content back to disk. */
export function saveFile(dir: string, rel: string, content: string): void {
  const target = join(dir, rel)
  if (!existsSync(dir)) throw new Error('Projektverzeichnis fehlt.')
  mkdirSync(dirname(target), { recursive: true }) // support crumbs in sub-folders
  writeFileSync(target, content, 'utf-8')
}

/** Add a new empty crumb file to a project and register it in the .bread. */
export function createFile(dir: string, rawName: string): ProjectFile {
  let rel = rawName.trim().replace(/\\/g, '/')
  if (!rel) throw new Error('Dateiname fehlt.')
  if (!rel.endsWith('.crumb')) rel += '.crumb'
  const target = join(dir, rel)
  if (existsSync(target)) throw new Error(`Datei existiert bereits: ${rel}`)

  mkdirSync(dirname(target), { recursive: true }) // support crumbs in sub-folders
  // CRUMB comments start with `;` (not BASIC's `'`); a `'` header would make the very
  // first line of every new file a lexer error (Befund 2).
  const header = `; ${rel}\n`
  writeFileSync(target, header, 'utf-8')

  const bread = readBread(dir)
  if (!bread.crumbs.includes(rel)) {
    bread.crumbs.push(rel)
    writeBread(dir, bread)
  }
  return { rel, content: header }
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
  const target = join(dir, rel)
  mkdirSync(dirname(target), { recursive: true }) // create assets/sprites/… if needed
  writeFileSync(target, content, 'utf-8')

  const bread = readBread(dir)
  if (kind === 'palette') {
    bread.assets.palette = rel
  } else if (kind === 'charset') {
    if (!bread.assets.charsets.includes(rel)) bread.assets.charsets.push(rel)
  } else if (kind === 'sprite') {
    if (!bread.assets.sprites.includes(rel)) bread.assets.sprites.push(rel)
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

// ---- project file tree (P2.T0b: the real-folder explorer) ----

/** Folders/files the explorer never shows: generated output + the project metafile. */
const TREE_HIDDEN = new Set(['build', '.git', 'node_modules'])

/**
 * Read the project folder recursively into a serialisable tree (PROJECT_EXPLORER.md
 * §2). Dirs first, then files, each alphabetical; `build/` and the `.bread` metafile
 * are hidden. Paths are project-relative with forward slashes (stable across OSes).
 */
export function readProjectTree(dir: string): TreeNode[] {
  if (!existsSync(dir)) return []
  const walk = (abs: string, relBase: string): TreeNode[] => {
    let entries: string[]
    try {
      entries = readdirSync(abs)
    } catch {
      return []
    }
    const nodes: TreeNode[] = []
    for (const name of entries) {
      if (TREE_HIDDEN.has(name)) continue
      if (name.endsWith('.bread')) continue // project metafile, not user content
      const childAbs = join(abs, name)
      const rel = relBase ? `${relBase}/${name}` : name
      let isDir = false
      try {
        isDir = statSync(childAbs).isDirectory()
      } catch {
        continue
      }
      if (isDir) nodes.push({ name, rel, kind: 'dir', children: walk(childAbs, rel) })
      else nodes.push({ name, rel, kind: 'file' })
    }
    // Dirs first, then files; each group alphabetical (case-insensitive).
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
    return nodes
  }
  return walk(dir, '')
}

/** Create a folder inside the project (recursive, idempotent). `rel` is project-
 *  relative; returns the normalised rel. Used by the save-as dialog's "new folder". */
export function createFolder(dir: string, rawRel: string): string {
  const rel = rawRel.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!rel) throw new Error('Ordnername fehlt.')
  if (!existsSync(dir)) throw new Error('Projektverzeichnis fehlt.')
  mkdirSync(join(dir, rel), { recursive: true })
  return rel
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

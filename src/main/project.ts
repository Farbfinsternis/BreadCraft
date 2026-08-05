import { app, dialog, BrowserWindow } from 'electron'
import { join, basename, dirname, resolve, sep } from 'path'
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
import {
  DEFAULT_SETTINGS,
  DEFAULT_GRAPHICS_MODE,
  DEFAULT_REGION,
  DEFAULT_PROJECT_TEMPLATE
} from '../shared/ipc'
import { graphicsCommandFor } from '../shared/graphics-mode'
import { serializeImage } from '../shared/asset-formats/image'
import type { Ssot } from '../shared/ssot-types'
import type {
  AssetKind,
  BreadAssets,
  GraphicsMode,
  ProjectTemplate,
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
   * DEPRECATED (ScreenMode block): the screen mode is a runtime `SetMode` switch, not
   * a project identity. New projects no longer write this field; old `.bread` files that
   * still carry it are read tolerantly and it is never persisted again. Kept in the type
   * only so old files parse — the asset editors default to TEXT_MULTICOLOR packing.
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

const EMPTY_ASSETS: BreadAssets = {
  palette: null,
  charsets: [],
  tilemaps: [],
  sprites: [],
  images: []
}

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

/** The entry crumb of a project dir (the `main.crumb` with the frame loop), read from
 *  its `.bread`. The build passes this to the transpiler as the Include root + the name
 *  its diagnostics carry (B3.T3); falls back to `main.crumb` for older/partial `.bread`. */
export function projectEntry(dir: string): string {
  const entry = readBread(dir).entry
  return typeof entry === 'string' && entry.length > 0 ? entry : 'main.crumb'
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
    sprites: Array.isArray(a.sprites) ? a.sprites.filter((s) => typeof s === 'string') : [],
    images: Array.isArray(a.images) ? a.images.filter((s) => typeof s === 'string') : []
  }
}

/** The image template's starter asset. The name matches the image editor's own default
 *  (`IMAGE_FILE` in the renderer's assetIo), so opening the Bild-Editor in a fresh image
 *  project lands on exactly this file — the picture the first build already showed. */
const STARTER_IMAGE_REL = 'main.image'
/** …and its asset id in source: the manifest matches by filename stem. */
const STARTER_IMAGE_ID = 'main'

/** The starter main.crumb — opens with a `SetMode …` line (the runtime screen-mode
 *  switch, spelled from the SSOT, never hardcoded). New projects start in the common
 *  TEXT, MULTICOLOR mode; it's a runtime switch the user flips freely (ScreenMode block).
 *
 *  The `image` template starts in BITMAP, MULTICOLOR instead and brings the two lines a
 *  picture needs — `UseImage` bakes it into the .prg, `DrawImage` puts it on screen. Both
 *  are needed: bitmap mode on its own has nothing to show. */
export function sampleMain(template: ProjectTemplate = DEFAULT_PROJECT_TEMPLATE): string {
  if (template === 'image') {
    return `; main.crumb — neues BreadCraft-Projekt mit einem gemalten Bild
; Setup-Phase

${graphicsCommandFor(SSOT, 'BITMAP_MULTICOLOR')}

; Das Bild kommt aus dem Bild-Editor (${STARTER_IMAGE_REL}). UseImage backt es beim Bauen
; an seinen Platz im Speicher, DrawImage zeigt es an — male einfach drauflos und baue neu.
UseImage "${STARTER_IMAGE_ID}"
DrawImage "${STARTER_IMAGE_ID}"

; --- Frame-Schleife ---
While 1
    VWait
Wend
`
  }
  return `; main.crumb — neues BreadCraft-Projekt
; Setup-Phase

${graphicsCommandFor(SSOT, DEFAULT_GRAPHICS_MODE)}

; --- Frame-Schleife ---
While 1
    VWait
Wend
`
}

/** The bare main.crumb when boilerplate is opted out: the fewest lines that still DO what
 *  the template promises. Plain = just the opening `SetMode …` so the project transpiles;
 *  image = the picture on screen and a loop to hold it there (a title screen that falls
 *  back to BASIC after one frame would not be a starter, it would be a flicker). */
function bareMain(template: ProjectTemplate = DEFAULT_PROJECT_TEMPLATE): string {
  if (template === 'image') {
    return [
      graphicsCommandFor(SSOT, 'BITMAP_MULTICOLOR'),
      `UseImage "${STARTER_IMAGE_ID}"`,
      `DrawImage "${STARTER_IMAGE_ID}"`,
      'While 1',
      '    VWait',
      'Wend',
      ''
    ].join('\n')
  }
  return `${graphicsCommandFor(SSOT, DEFAULT_GRAPHICS_MODE)}\n`
}

/**
 * The starter picture: a blue field inside a white frame, in the C64's own byte planes.
 *
 * Deliberately NOT an empty canvas. A blank image builds to a single flat colour, which
 * looks exactly like a broken build — the very confusion this starter exists to remove.
 * A frame is unmistakably A PICTURE: it proves the mode, the bake and the four-colour cell
 * all work, and it is one fill-tool click away from gone.
 *
 * Multicolor packing: each bitmap byte is four 2-bit pixels of one cell row, and the cell's
 * `%01` colour lives in the high nibble of its screen byte. A frame cell is therefore eight
 * rows of %01010101 ($55) with white ($1) in that nibble; every other pixel stays %00, the
 * shared background ($D021).
 */
export function starterImage(): string {
  const COLS = 40
  const ROWS = 25
  const BACKGROUND = 6 // blue — the C64's own screen colour
  const FRAME = 1 // white
  const SOLID_ROW = 0x55 // %01 %01 %01 %01 — four pixels of the cell's first colour

  const bitmap = new Array<number>(COLS * ROWS * 8).fill(0)
  const screen = new Array<number>(COLS * ROWS).fill(0)
  const color = new Array<number>(COLS * ROWS).fill(0)

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (row !== 0 && row !== ROWS - 1 && col !== 0 && col !== COLS - 1) continue
      const cell = row * COLS + col
      for (let y = 0; y < 8; y++) bitmap[cell * 8 + y] = SOLID_ROW
      screen[cell] = FRAME << 4
    }
  }
  return serializeImage(bitmap, screen, color, BACKGROUND)
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

/** Read + parse a `.bread`, normalising the asset manifest + region. `graphicsMode`
 *  is NOT injected here: it's a deprecated field (the screen mode is now a runtime
 *  `SetMode` switch, not a project identity — see ScreenMode block). Old files that
 *  still carry it are read tolerantly (see readProject) and it is never written back. */
function readBread(dir: string): BreadProjectFile {
  const bread = JSON.parse(readFileSync(breadPathFor(dir), 'utf-8')) as BreadProjectFile
  bread.assets = normalizeAssets(bread.assets)
  bread.region = normalizeRegion(bread.region)
  return bread
}

function readProject(dir: string, temporary: boolean): OpenedProject {
  const breadPath = breadPathFor(dir)
  const bread = readBread(dir)

  // The crumb list comes out of the `.bread` — a file on disk, so its paths get the same
  // check as anything arriving over IPC (B-12). A crooked entry must not stop the project
  // from OPENING, though: it reads as an empty file, exactly like one that has gone missing,
  // and the user can see and fix it in the explorer.
  const files: ProjectFile[] = bread.crumbs.map((rel) => {
    let content = ''
    try {
      const abs = resolveInside(dir, rel)
      if (existsSync(abs)) content = readFileSync(abs, 'utf-8')
    } catch {
      // outside the project → treated as not there
    }
    return { rel, content }
  })

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
 *  off writes the bare minimum. `template` decides WHAT is seeded — plain text-mode
 *  scaffold, or a picture project that also gets a starter `.image` on disk and the
 *  manifest entry to go with it. Neither is stored: the screen mode is a runtime
 *  `SetMode` switch, not a project identity. */
function scaffold(
  dir: string,
  name: string,
  temporary: boolean,
  withBoilerplate = true,
  region: Region = DEFAULT_REGION,
  template: ProjectTemplate = DEFAULT_PROJECT_TEMPLATE
): OpenedProject {
  mkdirSync(dir, { recursive: true })
  const entry = 'main.crumb'
  const content = withBoilerplate ? sampleMain(template) : bareMain(template)
  writeFileSync(join(dir, entry), content, 'utf-8')
  const assets: BreadAssets = { ...EMPTY_ASSETS }
  // The picture the starter's `UseImage` names has to EXIST, or the very first build fails
  // on an unknown asset — the opposite of a guided start. Written before the manifest so
  // both always agree.
  if (template === 'image') {
    writeFileSync(join(dir, STARTER_IMAGE_REL), starterImage(), 'utf-8')
    assets.images = [STARTER_IMAGE_REL]
  }
  writeBread(dir, {
    $format: 'bread',
    $version: BREAD_VERSION,
    name,
    entry,
    region,
    crumbs: [entry],
    assets
  })
  return readProject(dir, temporary)
}

/** Create a uniquely-named temporary project under <workspace>/temp. A temp
 *  project asks no questions (memory breadcraft-ide-architecture); it opens in the
 *  common TEXT, MULTICOLOR mode, a runtime switch the user can flip in the starter. */
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

/** Create a new permanent project under <workspace>/projects. No screen mode is chosen
 *  up front (ScreenMode block): a project has no single mode — `SetMode` switches it at
 *  runtime. The boilerplate flag (default on, A.8) chooses starter vs. bare main.crumb;
 *  `template` chooses what is seeded (plain, or a picture project with a starter image);
 *  region (STAHL S5c) is still a real target choice and is persisted. */
export function createProject(
  name: string,
  withBoilerplate = true,
  region: Region = DEFAULT_REGION,
  template: ProjectTemplate = DEFAULT_PROJECT_TEMPLATE
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
  return scaffold(dir, display, false, withBoilerplate, normalizeRegion(region), template)
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

/**
 * A project-relative path, resolved to an absolute one INSIDE the project — or an error
 * (Review #1, B-12).
 *
 * Every path that reaches the main process comes over IPC as a plain string: the renderer
 * asks to save `crumbs/physics.crumb`, and the main process joins it onto the project
 * directory and writes. Nothing checked where that string pointed. `../../.bashrc` is a
 * perfectly good relative path, and `join` resolves it happily — so a bug in the renderer,
 * a hand-edited `.bread`, or a pasted asset id could write outside the project the user
 * thinks they are working in. Nothing in BreadCraft sends such a path today; that is the
 * reason to close it now, while the answer is still "nothing legitimate breaks".
 *
 * ★ THE CHECK IS `dir + separator`, NOT `dir`. Comparing against the bare directory string
 * is the classic hole: for a project at `…/projects/held`, the path `../heldenreise/x`
 * resolves to `…/projects/heldenreise/x`, which starts with `…/projects/held` and would
 * sail through — a different project, silently written into.
 *
 * Honest about its limit: this is a LEXICAL check. It does not follow symlinks, because the
 * target of a write usually does not exist yet, so `realpath` has nothing to resolve. It
 * stops the accident and the pasted path, not an attacker who can already plant symlinks in
 * the project folder.
 */
export function resolveInside(dir: string, rel: string): string {
  const cleaned = String(rel ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!cleaned) throw new Error('Pfad fehlt.')
  // An absolute path is never project-relative — POSIX (`/etc`), Windows drive (`C:/…`)
  // and UNC (`//server/share`) alike. `resolve` would silently discard `dir` for these.
  if (/^([/\\]|[A-Za-z]:)/.test(cleaned)) {
    throw new Error(`Pfad muss innerhalb des Projekts liegen: ${rel}`)
  }
  const root = resolve(dir)
  const target = resolve(root, cleaned)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Pfad muss innerhalb des Projekts liegen: ${rel}`)
  }
  return target
}

/** Write a single crumb file's content back to disk. */
export function saveFile(dir: string, rel: string, content: string): void {
  const target = resolveInside(dir, rel)
  if (!existsSync(dir)) throw new Error('Projektverzeichnis fehlt.')
  mkdirSync(dirname(target), { recursive: true }) // support crumbs in sub-folders
  writeFileSync(target, content, 'utf-8')
}

/** Add a new empty crumb file to a project and register it in the .bread. */
export function createFile(dir: string, rawName: string): ProjectFile {
  let rel = rawName.trim().replace(/\\/g, '/')
  if (!rel) throw new Error('Dateiname fehlt.')
  if (!rel.endsWith('.crumb')) rel += '.crumb'
  const target = resolveInside(dir, rel)
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
  const target = resolveInside(dir, rel)
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
  const target = resolveInside(dir, rel)
  mkdirSync(dirname(target), { recursive: true }) // create assets/sprites/… if needed
  writeFileSync(target, content, 'utf-8')

  const bread = readBread(dir)
  if (kind === 'palette') {
    bread.assets.palette = rel
  } else if (kind === 'charset') {
    if (!bread.assets.charsets.includes(rel)) bread.assets.charsets.push(rel)
  } else if (kind === 'sprite') {
    if (!bread.assets.sprites.includes(rel)) bread.assets.sprites.push(rel)
  } else if (kind === 'image') {
    if (!bread.assets.images.includes(rel)) bread.assets.images.push(rel)
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
  mkdirSync(resolveInside(dir, rel), { recursive: true })
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

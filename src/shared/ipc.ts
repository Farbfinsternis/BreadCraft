// Shared DTO types crossing the IPC boundary (main ↔ preload ↔ renderer).
// Pure data, no Electron/Node imports — safe to import from any layer.

/** What BreadCraft opens on startup. Default 'welcome' (see DEFAULT_SETTINGS). */
export type StartupMode = 'welcome' | 'last'

/**
 * UI language. Only German and English are supported. Deutsch is the *source*
 * language (texts are authored in it); English is the fallback for everything
 * else. `null` means "not yet chosen" — on first run the app derives it from the
 * OS locale (German ⇒ 'de', anything else or undetectable ⇒ 'en') and persists
 * the result, so the OS is consulted only once.
 */
export type Locale = 'de' | 'en'

export interface RecentProject {
  /** Absolute path to the .bread file. */
  breadPath: string
  name: string
  /** ISO timestamp of last open. */
  openedAt: string
}

export interface AppConfig {
  workspaceRoot: string | null
  initialized: boolean
  /** Absolute .bread path of the most recently opened project (for restart restore). */
  lastProjectBread: string | null
  /** Startup behaviour (user-configurable via Settings; default in DEFAULT_SETTINGS). */
  startupMode: StartupMode
  /** Recently opened *permanent* projects, newest first (temp projects excluded). */
  recentProjects: RecentProject[]
  /**
   * Absolute path to the VICE C64 emulator executable (e.g. x64sc.exe). Per-machine,
   * not per-project. Used to test the first runnable .prg before the embedded `chips`
   * emulator is wired in (see memory: chips-emulator-decision, vice-runtime-interface).
   */
  vicePath: string | null
  /**
   * Chosen UI language, or null until the first run derives it from the OS locale
   * (German ⇒ 'de', anything else / undetectable ⇒ 'en'). Persisted once chosen;
   * user-changeable via Settings (project rule: persist everything — memory
   * breadcraft-persistence-rule, breadcraft-localization).
   */
  language: Locale | null
  /**
   * Last main-window geometry, restored on the next launch (project rule: persist
   * everything that survives a restart — memory breadcraft-persistence-rule). Stores
   * the NORMAL (un-maximized) bounds plus a maximized flag, so un-maximizing returns
   * to the right small size. null until the window has been shown once.
   */
  windowState: WindowState | null
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** The subset of AppConfig the Settings UI may write. Excludes app-managed state. */
export interface SettingsPatch {
  startupMode?: StartupMode
  vicePath?: string | null
  language?: Locale
}

/** Result of validating a VICE executable path (for the Settings UI feedback). */
export interface VicePathCheck {
  /** The file exists and is readable. */
  exists: boolean
  /** The filename looks like a VICE C64 emulator (x64sc / x64). */
  looksLikeVice: boolean
}

/**
 * Central settings defaults. Until a Settings UI exists, these are the values
 * the app runs with. The Settings UI will later read/write the same keys.
 */
export const DEFAULT_SETTINGS = {
  startupMode: 'welcome' as StartupMode,
  recentProjectsLimit: 10
} as const

export interface WorkspaceStatus {
  needsSetup: boolean
  config: AppConfig
}

export interface ProjectFile {
  /** Path relative to the project dir, e.g. "main.crumb". */
  rel: string
  content: string
}

/** Asset kinds with project-bound disk IO (ASSET_IO.md). */
export type AssetKind = 'palette' | 'charset' | 'tilemap' | 'sprite'

/**
 * The project-wide graphics mode — the root SSOT chosen at project creation that
 * drives both the editors (pixel aspect, palette layout) and the transpiler's
 * `Graphics …` command (BREADCRAFT_IDE.md §2.1). The three Phase-1 modes; only
 * TEXT_MULTICOLOR is selectable today (the others come later). Stored in `.bread`.
 */
export type GraphicsMode = 'TEXT_HIRES' | 'TEXT_MULTICOLOR' | 'BITMAP_MULTICOLOR'

/** Default mode for projects with no stored `graphicsMode` (old files) + temp projects. */
export const DEFAULT_GRAPHICS_MODE: GraphicsMode = 'TEXT_MULTICOLOR'

/** The C64 video standard the project targets (STAHL S5c). PAL (Europe, 50 Hz) and NTSC
 *  (US/Japan, 60 Hz) differ in frame rate AND per-frame cycle budget — NTSC's is smaller,
 *  so a game that just fits on PAL can overrun on NTSC. Chosen consciously, never silent. */
export type Region = 'PAL' | 'NTSC'

/** Default region for projects with no stored `region` (old files) + temp projects.
 *  PAL: the European retro scene's default and the historical BreadCraft assumption. */
export const DEFAULT_REGION: Region = 'PAL'

/** The `.bread` asset manifest (paths relative to the project dir). */
export interface BreadAssets {
  palette: string | null
  charsets: string[]
  tilemaps: string[]
  sprites: string[]
}

/** A node in the project's file tree (P2.T0b explorer). Paths are project-relative,
 *  forward-slash separated. Directories carry their children (sorted: dirs first). */
export interface TreeNode {
  name: string
  rel: string
  kind: 'dir' | 'file'
  children?: TreeNode[]
}

export interface OpenedProject {
  dir: string
  breadPath: string
  name: string
  entry: string
  files: ProjectFile[]
  temporary: boolean
  /** Project-wide graphics mode (root SSOT, IDE.md §2.1); drives editors + transpiler. */
  graphicsMode: GraphicsMode
  /** Target video standard (STAHL S5c); drives the PERF budget + the VICE launch region. */
  region: Region
  /** Asset manifest of the project (palette/charsets/tilemaps), for the editors. */
  assets: BreadAssets
}

/** One line of build/run output for the console (level styles it). */
export interface BuildLogLine {
  level: 'info' | 'cmd' | 'error' | 'ok' | 'warn'
  text: string
}

/** One fillable RAM pool, measured from a base address up to a ceiling (STAHL S1c).
 *  The bar fills toward the ceiling and turns red as the pool approaches the wall the
 *  linker would otherwise hit. */
export interface RamPool {
  /** Bytes occupied in this pool, from its base address. */
  usedBytes: number
  /** Budget from the base address up to the ceiling. */
  budgetBytes: number
  /** budgetBytes − usedBytes (negative if it would overflow). */
  freeBytes: number
  /** Fill fraction usedBytes / budgetBytes (≥ 1 means at/over the ceiling). */
  fraction: number
  /** 'ok' (room), 'warn' (close), 'over' (would cross the reserved space). */
  state: 'ok' | 'warn' | 'over'
  /** The C64 address this pool starts at ($0801 low pool, $8000 high pool). */
  baseAddr: number
  /** The C64 address the budget is measured up to. */
  ceilingAddr: number
}

/** How full RAM is after a build (STAHL S1c). The headline fields describe the LOW pool —
 *  code + data from the $0801 load address up to the graphics ceiling ($7000 bank 1,
 *  $3800 sprites-only, $D000 graphics-less). When the bank-1 (or bank-0 sprites-only)
 *  layout splits RAM into two non-fungible pools, `high` carries the second pool — the
 *  big BSS arrays that live above the graphics bank ($8000–$C800). The two pools can't
 *  trade bytes, so they get their own bars (B1.T5). */
export interface RamInfo extends RamPool {
  /** The high BSS pool (big arrays above the graphics bank), or absent for a single-pool
   *  layout (graphics-less, where BSS is contiguous with code below $D000). */
  high?: RamPool
}

/** A per-frame CPU-cost ESTIMATE, extrapolated from the code — a guess, not a runtime
 *  measurement (like BASSM's health bars). The 6502 has a hard per-frame cycle budget;
 *  cross it and the game drops from 50 to 25 fps. The bar shows roughly how full the
 *  frame is from what the .crumb does, so the cost is visible WHILE you write. */
export interface PerfInfo {
  /** Estimated 6502 cycles for ONE iteration of the main frame loop (incl. the
   *  functions it calls). A coarse guess — its value is the relative signal. */
  cyclesPerFrame: number
  /** One PAL frame's cycle budget (the wall: more than this halves the frame rate). */
  budgetCycles: number
  /** cyclesPerFrame / budgetCycles (≥ 1 means the frame would overrun). */
  fraction: number
  /** 'ok' (room), 'warn' (getting tight), 'over' (would overrun → 25fps). */
  state: 'ok' | 'warn' | 'over'
  /** Which video standard the budget is measured against (STAHL S5c) — so the bar can
   *  say "of PAL" / "of NTSC" and the number is never silently one region. */
  region: Region
}

/** Result of a Build & Run: which stage reached, logs, and what to show. */
export interface BuildResult {
  ok: boolean
  /** How far it got: 'compile' (.crumb→C), 'cc65' (C→.prg), 'run' (started VICE). */
  stage: 'compile' | 'cc65' | 'run'
  log: BuildLogLine[]
  /** The generated C source (for inspection / a future "show C" view). */
  cCode?: string
  /** Absolute path to the produced .prg, if cc65 succeeded. */
  prgPath?: string
  /** True when the .prg was built but no VICE path is configured to run it. */
  needsVicePath?: boolean
  /** RAM usage vs the planned ceiling (STAHL S1c) — set when a .prg was produced, or
   *  reported as `over` when the linker rejected the build for overflowing the island. */
  ram?: RamInfo
  /** Estimated per-frame CPU cost (a guess from the code) — feeds the PERF health-bar. */
  perf?: PerfInfo
}

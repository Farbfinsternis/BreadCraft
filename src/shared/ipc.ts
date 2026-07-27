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
   * Whether the first-run VICE onboarding screen has been shown and dismissed (T2).
   * App-managed (not user-editable): once true, the onboarding never auto-opens again,
   * though the user can still reach VICE setup from the Run prompt or Settings.
   */
  viceOnboardingSeen: boolean
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
 * Outcome of the "pick a VICE folder" browse. The user chooses a *directory* and
 * BreadCraft finds the executable inside it (a newbie shouldn't have to know it's
 * `x64sc.exe`). `path` is the resolved executable when `ok`, the chosen folder when
 * `notfound` (so the UI can name where it looked), and null when the user cancelled.
 */
export interface ViceBrowseResult {
  status: 'ok' | 'notfound' | 'cancelled'
  path: string | null
}

/** Live progress of the in-app VICE download/install (T3). */
export interface ViceDownloadProgress {
  phase: 'downloading' | 'verifying' | 'extracting'
  /** 0–100 while downloading, when the server reports a size; omitted otherwise. */
  percent?: number
}

/** Final outcome of the in-app VICE download/install (T3). */
export interface ViceDownloadResult {
  ok: boolean
  /** Resolved x64sc/x64 path on success. */
  path?: string
  /** Short reason on failure, for a friendly message + fallback. */
  error?: string
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
export type AssetKind = 'palette' | 'charset' | 'tilemap' | 'sprite' | 'image'

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
  images: string[]
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
  /** The source location this line points at (B3.T4) — a compile error/warning in a
   *  specific `.crumb` file (`file` is project-relative; absent for a nameless single-file
   *  compile). When present, the console renders the line as a clickable jump and the code
   *  editor marks the line in that file. */
  loc?: { file?: string; line: number; col: number }
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
  /** Estimated 6502 cycles for an ORDINARY iteration of the main frame loop (incl. the
   *  functions it calls). A coarse guess — its value is the relative signal. */
  cyclesPerFrame: number
  /** One PAL frame's cycle budget (the wall: more than this halves the frame rate). */
  budgetCycles: number
  /** How full the fullest ROOM of the worst frame is — ≥ 1 means that frame would overrun.
   *  Without a scrolling world that is simply cyclesPerFrame / budgetCycles; inside one it
   *  is the fuller of the frame's two rooms on the heavy frame (see `world`), because a
   *  mean over eight frames hides exactly the frame that tears (S1.B4). */
  fraction: number
  /** 'ok' (room), 'warn' (getting tight), 'over' (would overrun → 25fps). */
  state: 'ok' | 'warn' | 'over'
  /** Which video standard the budget is measured against (STAHL S5c) — so the bar can
   *  say "of PAL" / "of NTSC" and the number is never silently one region. */
  region: Region
  /** Set when the program scrolls a world (`UseMap`): the frame then has two rooms with
   *  separate deadlines, and one figure spanning the whole frame would flatter it. */
  world?: PerfWorld
}

/** A SCROLLING FRAME HAS TWO DEADLINES, not one budget (S1.B4/Schritt 2 — measured,
 *  SCROLLING_PLAN T2c/T4/Schritt 2 T1):
 *
 *    - THE ROOM — what the program's own frame code may cost. A raster interrupt now does
 *      the splitting, so the program has to be nowhere in particular: it gets the whole
 *      frame MINUS what moving the band takes out of it. Overrun it and the step is dropped
 *      — the world stutters, it does not tear.
 *    - THE TAIL — below the band, the only place the band may be moved. The coarse shift
 *      lives here and its room is what is LEFT of the frame: `312 − 8·H` raster lines.
 *
 *  THE LEVER RUNS ONE WAY NOW, and that is the point of the interrupt (Schritt 2). A taller
 *  play field grows the shift's work AND shrinks the tail it must fit into — that scissor is
 *  why the honest ceiling sits near ten band rows, and the bar DERIVES it rather than being
 *  told. A flatter play field now gives the program MORE thinking time as well (measured on
 *  hardware: at six band rows 16.363 cycles against 2.774 with the old waiting technique),
 *  where before it gave less. One lever, both walls.
 *
 *  Only every 8th pixel does the band physically move (`$D016` shifts the picture 0–7
 *  pixels for one register write, for free), so with a moving camera one frame in eight is
 *  the heavy one. These figures describe THAT frame — and the room is quoted as if every
 *  frame were heavy, because that is the floor a game can count on (Schritt 2, Befund 1:
 *  the light frames may be borrowed, but they may not be promised). */
export interface PerfWorld {
  /** Tile rows that travel (`PlayField`) — the driver of both deadlines. */
  bandRows: number
  /** Cycles the frame leaves the program's own code once the band's move is paid for. */
  roomCycles: number
  /** Estimated cycles used there: the program's own code, plus building the column about
   *  to appear. */
  roomUsed: number
  /** Cycles the tail offers below the band (the rest of the frame). */
  tailCycles: number
  /** Estimated cycles used there on the heavy frame: the coarse shift, plus handing the
   *  sprite set to the VIC. */
  tailUsed: number
  /** What the coarse shift alone costs — 0 for a world whose window never travels (it pays
   *  nothing for a move it never makes). */
  shiftCycles: number
  /** How often the heavy frame lands: every Nth frame at full camera speed (8 = one pixel
   *  per frame, eight pixels to a character). 0 for a standing world — all frames alike. */
  everyFrames: number
  /** Which wall is the nearer one, i.e. what `fraction` is about. The lever differs:
   *  'room' → the program does too much per frame; 'tail' → the band is too tall. */
  wall: 'room' | 'tail'
}

/** What the scrolling level itself costs in RAM (S1.B4) — reported by the compiler so the
 *  RAM bar can NAME the world's bytes instead of leaving a designer to guess which part of
 *  a full bar is the map. Absent for a program without `UseMap`. */
export interface LevelInfo {
  /** The tilemap asset id that was baked. */
  id: string
  /** Level columns (a screen is 40). */
  columns: number
  /** Band rows stored per column (from `PlayField`). */
  bandRows: number
  /** Bytes the baked level occupies (column data plus the tile→colour table, if any). */
  bytes: number
  /** Whether colour came per TILE (cheap) or per CELL (twice the column data). */
  model: 'tileTable' | 'perCell'
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
  /** The scrolling level baked into this build (S1.B4) — lets the RAM bar say how much of
   *  the RAM is the world. Absent for a program without `UseMap`. */
  level?: LevelInfo
}

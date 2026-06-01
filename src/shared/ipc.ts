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
export type AssetKind = 'palette' | 'charset' | 'tilemap'

/** The `.bread` asset manifest (paths relative to the project dir). */
export interface BreadAssets {
  palette: string | null
  charsets: string[]
  tilemaps: string[]
}

export interface OpenedProject {
  dir: string
  breadPath: string
  name: string
  entry: string
  files: ProjectFile[]
  temporary: boolean
  /** Asset manifest of the project (palette/charsets/tilemaps), for the editors. */
  assets: BreadAssets
}

/** One line of build/run output for the console (level styles it). */
export interface BuildLogLine {
  level: 'info' | 'cmd' | 'error' | 'ok' | 'warn'
  text: string
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
}

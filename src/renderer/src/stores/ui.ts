import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { GraphicsMode, Region } from '@shared/ipc'

export type CollapsiblePanel = 'explorer' | 'outliner' | 'console'

/** One selectable graphics mode in the New-Project dialog. Disabled modes show as
 *  "coming later" (M1.T6: only TEXT_MULTICOLOR is enabled in Phase 1). */
export interface ModeChoice {
  value: GraphicsMode
  label: string
  hint?: string
  disabled?: boolean
}

/** One selectable target region in the New-Project dialog (STAHL S5c: PAL | NTSC). */
export interface RegionChoice {
  value: Region
  label: string
  hint?: string
}

/** A New-Project dialog request (name + mode + boilerplate toggle). */
export interface NewProjectRequest {
  title: string
  nameLabel: string
  namePlaceholder?: string
  modeLabel: string
  modes: ModeChoice[]
  regionLabel: string
  regions: RegionChoice[]
  boilerplateLabel: string
  confirmLabel: string
}

/** The user's answer to the New-Project dialog (null = cancelled). */
export interface NewProjectResult {
  name: string
  graphicsMode: GraphicsMode
  region: Region
  withBoilerplate: boolean
}

/**
 * A modal prompt request. Electron renderers disable window.prompt/alert (they
 * return null / do nothing), so name entry and error messages go through our own
 * in-app dialog instead (PromptModal.vue). `kind` switches the dialog between an
 * input field (ask) and a message-only acknowledgement (notify).
 */
export interface PromptRequest {
  kind: 'input' | 'message' | 'confirm'
  title: string
  label?: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  message?: string
}

/** A "save as" request (P2.T0b): pick a folder + name inside the project. The editor
 *  fixes the extension (sprite→.sprite etc.), so the user only chooses where + the
 *  name. `initialRel` pre-selects the folder/name when re-saving an existing asset. */
export interface SaveAsRequest {
  title: string
  /** The fixed extension the editor enforces, incl. the dot (e.g. '.sprite'). */
  ext: string
  /** Pre-filled project-relative path (with ext) when one is already open; '' = new. */
  initialRel?: string
}

/** The chosen project-relative path WITH the fixed extension (null = cancelled). */
export type SaveAsResult = string | null

interface SizeBounds {
  min: number
  max: number
}

const BOUNDS: Record<CollapsiblePanel, SizeBounds> = {
  explorer: { min: 160, max: 520 },
  outliner: { min: 160, max: 520 },
  console: { min: 80, max: 600 }
}

function clamp(value: number, { min, max }: SizeBounds): number {
  return Math.max(min, Math.min(max, value))
}

const STORAGE_KEY = 'breadcraft.ui'

interface PersistedUi {
  collapsed: Record<CollapsiblePanel, boolean>
  sizes: Record<CollapsiblePanel, number>
  /** Zen mode: hide the side panels (explorer/outliner/console) so an editor gets
   *  full width. Toolbar + HealthBars deliberately stay (cost-honesty always
   *  visible — memory breadcraft-health-bars). Persisted (persist-everything rule). */
  zen: boolean
  /** Light table (onion skin): in the PETSCII/Tileset editor, show the previous tile
   *  (slot N−1) as a faint colour ghost beneath the paint grid, so animation phases
   *  (painted into consecutive slots, later driven by AnimateTile) can be aligned
   *  frame-to-frame. Editor-local, knows nothing about AnimateTile. Persisted. */
  lightTable: boolean
}

function loadPersisted(): Partial<PersistedUi> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<PersistedUi>) : {}
  } catch {
    return {}
  }
}

/** UI layout state: collapse flags + resizable panel sizes (px). Persisted to localStorage. */
export const useUiStore = defineStore(
  'ui',
  () => {
    const saved = loadPersisted()

    const collapsed = reactive<Record<CollapsiblePanel, boolean>>({
      explorer: false,
      outliner: false,
      console: false,
      ...saved.collapsed
    })

    // explorer/outliner are widths; console is a height.
    const sizes = reactive<Record<CollapsiblePanel, number>>({
      explorer: clamp(saved.sizes?.explorer ?? 250, BOUNDS.explorer),
      outliner: clamp(saved.sizes?.outliner ?? 230, BOUNDS.outliner),
      console: clamp(saved.sizes?.console ?? 190, BOUNDS.console)
    })

    // Zen mode hides the side panels for a full-width editor (see PersistedUi).
    const zen = ref<boolean>(saved.zen ?? false)

    // Light table (onion skin) for the PETSCII/Tileset editor (see PersistedUi).
    const lightTable = ref<boolean>(saved.lightTable ?? false)

    // ---- in-app prompt dialog (replaces the Electron-disabled window.prompt/alert) ----
    // The active request (null = closed) and the resolver that the modal calls back.
    const prompt = ref<PromptRequest | null>(null)
    let resolver: ((value: string | null) => void) | null = null

    // ---- New-Project dialog (structured: name + mode + boilerplate) ----
    const newProject = ref<NewProjectRequest | null>(null)
    let newProjectResolver: ((value: NewProjectResult | null) => void) | null = null

    // ---- Save-As file dialog (P2.T0b: pick folder + name in the project) ----
    const saveAs = ref<SaveAsRequest | null>(null)
    let saveAsResolver: ((value: SaveAsResult) => void) | null = null

    /** Ask the user for a string. Resolves with the trimmed text, or null if
     *  cancelled (Esc / Cancel / click-outside). */
    function ask(opts: Omit<PromptRequest, 'kind'>): Promise<string | null> {
      return new Promise((resolve) => {
        resolver = resolve
        prompt.value = { ...opts, kind: 'input' }
      })
    }

    /** Show a message-only dialog (replaces window.alert). Resolves when dismissed. */
    function notify(opts: Omit<PromptRequest, 'kind'>): Promise<void> {
      return new Promise((resolve) => {
        resolver = () => resolve()
        prompt.value = { ...opts, kind: 'message' }
      })
    }

    /** Ask a yes/no question (replaces window.confirm). Resolves true if the user
     *  confirms, false on cancel/Esc/click-outside. Two buttons, no text field. */
    function confirm(opts: Omit<PromptRequest, 'kind'>): Promise<boolean> {
      return new Promise((resolve) => {
        resolver = (value) => resolve(value !== null)
        prompt.value = { ...opts, kind: 'confirm' }
      })
    }

    /** Confirm the prompt with a value (the modal calls this). */
    function resolvePrompt(value: string): void {
      const r = resolver
      prompt.value = null
      resolver = null
      r?.(value)
    }

    /** Cancel the prompt (the modal calls this). */
    function cancelPrompt(): void {
      const r = resolver
      prompt.value = null
      resolver = null
      r?.(null)
    }

    /** Open the New-Project dialog; resolves with the choice, or null if cancelled. */
    function askNewProject(req: NewProjectRequest): Promise<NewProjectResult | null> {
      return new Promise((resolve) => {
        newProjectResolver = resolve
        newProject.value = req
      })
    }

    /** Confirm the New-Project dialog with the user's choice (the modal calls this). */
    function resolveNewProject(value: NewProjectResult): void {
      const r = newProjectResolver
      newProject.value = null
      newProjectResolver = null
      r?.(value)
    }

    /** Cancel the New-Project dialog (the modal calls this). */
    function cancelNewProject(): void {
      const r = newProjectResolver
      newProject.value = null
      newProjectResolver = null
      r?.(null)
    }

    /** Open the Save-As dialog; resolves with a project-relative path (with the fixed
     *  extension), or null if cancelled. */
    function askSavePath(req: SaveAsRequest): Promise<SaveAsResult> {
      return new Promise((resolve) => {
        saveAsResolver = resolve
        saveAs.value = req
      })
    }

    /** Confirm the Save-As dialog with the chosen rel (the modal calls this). */
    function resolveSaveAs(rel: string): void {
      const r = saveAsResolver
      saveAs.value = null
      saveAsResolver = null
      r?.(rel)
    }

    /** Cancel the Save-As dialog (the modal calls this). */
    function cancelSaveAs(): void {
      const r = saveAsResolver
      saveAs.value = null
      saveAsResolver = null
      r?.(null)
    }

    function collapse(panel: CollapsiblePanel): void {
      collapsed[panel] = true
    }

    function expand(panel: CollapsiblePanel): void {
      collapsed[panel] = false
    }

    function setSize(panel: CollapsiblePanel, value: number): void {
      sizes[panel] = clamp(value, BOUNDS[panel])
    }

    function toggleZen(): void {
      zen.value = !zen.value
    }

    function setZen(value: boolean): void {
      zen.value = value
    }

    function toggleLightTable(): void {
      lightTable.value = !lightTable.value
    }

    return {
      collapsed,
      sizes,
      zen,
      lightTable,
      prompt,
      newProject,
      saveAs,
      collapse,
      expand,
      setSize,
      toggleZen,
      setZen,
      toggleLightTable,
      ask,
      notify,
      confirm,
      resolvePrompt,
      cancelPrompt,
      askNewProject,
      resolveNewProject,
      cancelNewProject,
      askSavePath,
      resolveSaveAs,
      cancelSaveAs
    }
  },
  { persist: { key: STORAGE_KEY, paths: ['collapsed', 'sizes', 'zen', 'lightTable'] } }
)

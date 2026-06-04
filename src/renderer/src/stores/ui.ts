import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { GraphicsMode } from '@shared/ipc'

export type CollapsiblePanel = 'explorer' | 'outliner' | 'console'

/** One selectable graphics mode in the New-Project dialog. Disabled modes show as
 *  "coming later" (M1.T6: only TEXT_MULTICOLOR is enabled in Phase 1). */
export interface ModeChoice {
  value: GraphicsMode
  label: string
  hint?: string
  disabled?: boolean
}

/** A New-Project dialog request (name + mode + boilerplate toggle). */
export interface NewProjectRequest {
  title: string
  nameLabel: string
  namePlaceholder?: string
  modeLabel: string
  modes: ModeChoice[]
  boilerplateLabel: string
  confirmLabel: string
}

/** The user's answer to the New-Project dialog (null = cancelled). */
export interface NewProjectResult {
  name: string
  graphicsMode: GraphicsMode
  withBoilerplate: boolean
}

/**
 * A modal prompt request. Electron renderers disable window.prompt/alert (they
 * return null / do nothing), so name entry and error messages go through our own
 * in-app dialog instead (PromptModal.vue). `kind` switches the dialog between an
 * input field (ask) and a message-only acknowledgement (notify).
 */
export interface PromptRequest {
  kind: 'input' | 'message'
  title: string
  label?: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  message?: string
}

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

    // ---- in-app prompt dialog (replaces the Electron-disabled window.prompt/alert) ----
    // The active request (null = closed) and the resolver that the modal calls back.
    const prompt = ref<PromptRequest | null>(null)
    let resolver: ((value: string | null) => void) | null = null

    // ---- New-Project dialog (structured: name + mode + boilerplate) ----
    const newProject = ref<NewProjectRequest | null>(null)
    let newProjectResolver: ((value: NewProjectResult | null) => void) | null = null

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

    return {
      collapsed,
      sizes,
      zen,
      prompt,
      newProject,
      collapse,
      expand,
      setSize,
      toggleZen,
      setZen,
      ask,
      notify,
      resolvePrompt,
      cancelPrompt,
      askNewProject,
      resolveNewProject,
      cancelNewProject
    }
  },
  { persist: { key: STORAGE_KEY, paths: ['collapsed', 'sizes', 'zen'] } }
)

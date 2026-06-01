import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'

export type CollapsiblePanel = 'explorer' | 'outliner' | 'console'

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

    return { collapsed, sizes, zen, collapse, expand, setSize, toggleZen, setZen }
  },
  { persist: { key: STORAGE_KEY, paths: ['collapsed', 'sizes', 'zen'] } }
)

import { reactive } from 'vue'
import { defineStore } from 'pinia'

const STORAGE_KEY = 'breadcraft.panels'

/**
 * Floating-panel layout for the pixel editors (DPaint-style toolbox: drag, resize,
 * overlap, raise-on-touch). Geometry is persisted so a carefully arranged layout
 * survives a restart (project rule: persist everything — memory
 * breadcraft-persistence-rule). Panels are keyed by a flat id like
 * "petscii.charset"; each editor seeds its defaults via `ensure()`.
 *
 * Reusable across all pixel editors (PETSCII/Sprite/Tilemap) — the same DRY stance
 * as the pixel-engine (memory breadcraft-pixel-engine).
 */

export interface PanelRect {
  x: number
  y: number
  width: number
  height: number
  z: number
}

export type PanelDefaults = Record<string, Omit<PanelRect, 'z'>>

interface PersistedPanels {
  rects: Record<string, PanelRect>
}

function loadPersisted(): Record<string, PanelRect> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedPanels).rects ?? {} : {}
  } catch {
    return {}
  }
}

export const usePanelsStore = defineStore(
  'panels',
  () => {
    const rects = reactive<Record<string, PanelRect>>(loadPersisted())
    // Remember each editor's defaults so "reset layout" can restore them.
    const defaults = reactive<Record<string, Omit<PanelRect, 'z'>>>({})
    let topZ = 10

    /** Register an editor's panels with their default positions. Only fills in
     *  panels not already persisted, so a saved layout wins over defaults.
     *
     *  `minSizes` (optional) gives a per-panel minimum width/height. A persisted
     *  panel smaller than its minimum is bumped up once here — so raising a tool
     *  panel's minimum (e.g. to always fit every tool) also repairs layouts saved
     *  before the change, not just fresh ones. */
    function ensure(
      scope: string,
      panelDefaults: PanelDefaults,
      minSizes?: Record<string, { minWidth?: number; minHeight?: number }>
    ): void {
      let z = topZ
      for (const [id, def] of Object.entries(panelDefaults)) {
        const key = `${scope}.${id}`
        defaults[key] = def
        if (!rects[key]) {
          rects[key] = { ...def, z: ++z }
        } else {
          const min = minSizes?.[id]
          if (min?.minWidth && rects[key].width < min.minWidth) rects[key].width = min.minWidth
          if (min?.minHeight && rects[key].height < min.minHeight) rects[key].height = min.minHeight
        }
      }
      topZ = z
    }

    function rect(scope: string, id: string): PanelRect | undefined {
      return rects[`${scope}.${id}`]
    }

    function move(scope: string, id: string, x: number, y: number): void {
      const r = rects[`${scope}.${id}`]
      if (r) {
        r.x = x
        r.y = y
      }
    }

    function resize(scope: string, id: string, width: number, height: number): void {
      const r = rects[`${scope}.${id}`]
      if (r) {
        r.width = width
        r.height = height
      }
    }

    /** Bring a panel to the front (raise-on-touch). */
    function raise(scope: string, id: string): void {
      const r = rects[`${scope}.${id}`]
      if (r) r.z = ++topZ
    }

    /** Reset all panels of a scope to their registered defaults (newbie escape
     *  hatch — memory breadcraft-nerd-newbie-spagat). */
    function reset(scope: string): void {
      let z = 10
      for (const key of Object.keys(rects)) {
        if (!key.startsWith(`${scope}.`)) continue
        const def = defaults[key]
        if (def) rects[key] = { ...def, z: ++z }
      }
      topZ = z
    }

    return { rects, ensure, rect, move, resize, raise, reset }
  },
  {
    persist: { key: STORAGE_KEY, paths: ['rects'] }
  }
)

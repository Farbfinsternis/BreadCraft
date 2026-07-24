import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * Where you are looking at the map, and how close (S1.B2.T2) — the free canvas of the
 * tilemap editor. A level may be several screens wide, so the editor stops being "one
 * picture scaled into a panel" and becomes a window you move over a landscape.
 *
 * Persisted (project rule: everything that survives a restart must persist, memory
 * breadcraft-persistence-rule) — coming back to a level should put you back where you
 * were working, not at the far left edge. UI-only state, hence localStorage like the
 * other view stores (ui.ts/panels.ts/docs.ts).
 *
 * `zoom` is PIXELS PER MAP PIXEL (a cell is 8 map pixels): 1 = the C64's native size,
 * 4 = comfortable tile painting, 0.5 = the shape of the whole level. `panX`/`panY` are
 * the viewport's top-left corner in MAP PIXELS — zoom-independent, so zooming never
 * teleports the view. `zoom === null` means "not chosen yet": the view fits the map
 * into the panel, which is exactly how a one-screen map has always looked.
 */
const STORAGE_KEY = 'breadcraft.mapview'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 16

interface PersistedMapView {
  zoom: number | null
  panX: number
  panY: number
}

function loadPersisted(): Partial<PersistedMapView> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<PersistedMapView>) : {}
  } catch {
    return {}
  }
}

export const useMapViewStore = defineStore(
  'mapview',
  () => {
    const saved = loadPersisted()
    const zoom = ref<number | null>(typeof saved.zoom === 'number' ? saved.zoom : null)
    const panX = ref(typeof saved.panX === 'number' ? saved.panX : 0)
    const panY = ref(typeof saved.panY === 'number' ? saved.panY : 0)

    function setZoom(z: number): void {
      zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
    }

    function setPan(x: number, y: number): void {
      panX.value = x
      panY.value = y
    }

    /** Back to "fit the whole map into the panel" — the view a new map starts with. */
    function reset(): void {
      zoom.value = null
      panX.value = 0
      panY.value = 0
    }

    return { zoom, panX, panY, setZoom, setPan, reset }
  },
  { persist: { key: STORAGE_KEY, paths: ['zoom', 'panX', 'panY'] } }
)

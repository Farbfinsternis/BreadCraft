import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  MAP_W,
  MAP_H,
  TILEMAP_FILE,
  DEFAULT_COLOR_RAM,
  parseTilemap,
  serializeTilemap
} from './assetIo'

/**
 * The 40×25 graphics-layer tilemap drawn in the Tilemap editor.
 *
 * Each cell holds a TILE NUMBER 0–255 (an index into the project charset — the
 * "tiles" painted in the PETSCII editor) AND a COLOR-RAM colour 0–15 (the free 4th
 * multicolor colour, chosen per 8×8 cell — PETSCII_FORMAT.md §2.2, the C64's real
 * per-cell colour). The grid is DENSE (a map is filled), so two flat Uint8Arrays
 * (1000 each, row-major, cell = row*40 + col) are the natural model.
 *
 * PERSISTENCE (ASSET_IO.md / TILEMAP_EDITOR.md §5): lives on disk as the project's
 * `.tilemap` asset, referenced from the `.bread` manifest. Phase 1 = one visible
 * graphics layer (tiles + Color-RAM); the file format is already a layer ARRAY so
 * later layers slot in. Saving is EXPLICIT (button / Ctrl+S, ASSET_DOCUMENTS.md
 * §2.5) — a dirty flag drives the editor's save indicator.
 */

const MAP_CELLS = MAP_W * MAP_H // 1000

/**
 * The "empty" tile = Space (C64 screen code 32), NOT slot 0. Slot 0 is `@` in the
 * native font; Space is blank in the standard font and is exactly what Cls/clrscr/
 * bc_cls write ($20). A fresh map, Clear and the eraser all stamp this, so an empty
 * cell renders blank as long as slot 32 is kept blank (TILEMAP_EDITOR_UX 2026-06-23).
 */
export const EMPTY_TILE = 32

export const useTilemapStore = defineStore('tilemap', () => {
  // Dense parallel grids (row-major). A bumped ref version lets the editor
  // re-render on in-place writes (a Uint8Array isn't deeply reactive).
  const tiles = ref<Uint8Array>(new Uint8Array(MAP_CELLS).fill(EMPTY_TILE))
  const colors = ref<Uint8Array>(new Uint8Array(MAP_CELLS).fill(DEFAULT_COLOR_RAM))
  const version = ref(0)
  const dirty = ref(false)

  // The project this map belongs to (set on load). Saves target this dir.
  let projectDir: string | null = null
  let assetRel: string = TILEMAP_FILE

  /** The tile number at a cell (EMPTY_TILE = blank Space). */
  function tileAt(col: number, row: number): number {
    if (col < 0 || col >= MAP_W || row < 0 || row >= MAP_H) return EMPTY_TILE
    return tiles.value[row * MAP_W + col]
  }

  /** The Color-RAM colour (0–15) at a cell. */
  function colorAt(col: number, row: number): number {
    if (col < 0 || col >= MAP_W || row < 0 || row >= MAP_H) return DEFAULT_COLOR_RAM
    return colors.value[row * MAP_W + col]
  }

  /** Paint one cell with a tile number AND its Color-RAM colour (the free MC colour
   *  for that 8×8 cell). Marks dirty only — saving is EXPLICIT. No-op if unchanged. */
  function setTile(col: number, row: number, n: number, color: number): void {
    if (col < 0 || col >= MAP_W || row < 0 || row >= MAP_H) return
    const i = row * MAP_W + col
    if (tiles.value[i] === n && colors.value[i] === color) return
    tiles.value[i] = n & 0xff
    colors.value[i] = color & 0x0f
    version.value++
    dirty.value = true
  }

  /** Load the project's tilemap asset from disk (called on project open). */
  async function loadForProject(dir: string, rel: string | null): Promise<void> {
    projectDir = dir
    assetRel = rel ?? TILEMAP_FILE
    tiles.value = new Uint8Array(MAP_CELLS).fill(EMPTY_TILE)
    colors.value = new Uint8Array(MAP_CELLS).fill(DEFAULT_COLOR_RAM)
    version.value++
    dirty.value = false
    if (!rel) return // no tilemap asset yet — start empty
    const text = await window.breadcraft.assets.read(dir, rel)
    if (!text) return
    const parsed = parseTilemap(text)
    if (parsed) {
      tiles.value = parsed.tiles
      colors.value = parsed.colors
      version.value++
    }
  }

  /** Write the tilemap to disk (explicit save: button / Ctrl+S). */
  async function save(): Promise<void> {
    if (!projectDir) return
    const text = serializeTilemap({ tiles: tiles.value, colors: colors.value })
    await window.breadcraft.assets.write(projectDir, 'tilemap', assetRel, text)
    dirty.value = false
  }

  function currentRel(): string {
    return assetRel
  }

  /** Switch the editor to another map file (P2.T0): save pending, then load. */
  async function switchAsset(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    await loadForProject(dir, rel)
  }

  /** Create a NEW empty map file at `rel` and bind to it (P2.T0). */
  async function createBlank(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    projectDir = dir
    assetRel = rel
    tiles.value = new Uint8Array(MAP_CELLS).fill(EMPTY_TILE)
    colors.value = new Uint8Array(MAP_CELLS).fill(DEFAULT_COLOR_RAM)
    version.value++
    dirty.value = false
    const text = serializeTilemap({ tiles: tiles.value, colors: colors.value })
    await window.breadcraft.assets.write(dir, 'tilemap', rel, text)
  }

  /** Empty the whole map in one step (T1): every cell back to Space (EMPTY_TILE) +
   *  the default Color-RAM colour. Destructive and there is no undo yet, so the editor
   *  guards this behind a confirm dialog. A new array identity triggers a full redraw. */
  function clear(): void {
    tiles.value = new Uint8Array(MAP_CELLS).fill(EMPTY_TILE)
    colors.value = new Uint8Array(MAP_CELLS).fill(DEFAULT_COLOR_RAM)
    version.value++
    dirty.value = true
  }

  /** "Save as" (P2.T0b): bind to a new rel and write the CURRENT map there. */
  async function saveTo(dir: string, rel: string): Promise<void> {
    projectDir = dir
    assetRel = rel
    const text = serializeTilemap({ tiles: tiles.value, colors: colors.value })
    await window.breadcraft.assets.write(dir, 'tilemap', rel, text)
    dirty.value = false
  }

  return {
    tiles,
    colors,
    version,
    dirty,
    tileAt,
    colorAt,
    setTile,
    clear,
    loadForProject,
    save,
    currentRel,
    switchAsset,
    createBlank,
    saveTo
  }
})

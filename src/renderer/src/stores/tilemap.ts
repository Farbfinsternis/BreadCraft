import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  MAP_W,
  MAP_H,
  MAX_MAP_W,
  TILEMAP_FILE,
  DEFAULT_COLOR_RAM,
  parseTilemap,
  serializeTilemap
} from './assetIo'

/**
 * The graphics-layer tilemap drawn in the Tilemap editor.
 *
 * Each cell holds a TILE NUMBER 0–255 (an index into the project charset — the
 * "tiles" painted in the PETSCII editor) AND a COLOR-RAM colour 0–15 (the free 4th
 * multicolor colour, chosen per 8×8 cell — PETSCII_FORMAT.md §2.2, the C64's real
 * per-cell colour). The grid is DENSE (a map is filled), so two flat Uint8Arrays
 * (row-major, cell = row*width + col) are the natural model.
 *
 * SIZE (S1.B2.T1): a map is `width` × `height` cells. One screen (40×25) is the
 * default and what every pre-B2 file is, but a scrolling world may be WIDER — the
 * file's own dimensions decide, never a constant. Height stays one screen while
 * vertical scrolling is deferred. Row-major is kept on purpose: the scrolling engine
 * reads COLUMNS, but transposing is compile-time work for the codegen (S1.B3) and
 * costs the running C64 nothing — so the painting code stays untouched.
 *
 * PERSISTENCE (ASSET_IO.md / TILEMAP_EDITOR.md §5): lives on disk as the project's
 * `.tilemap` asset, referenced from the `.bread` manifest. Phase 1 = one visible
 * graphics layer (tiles + Color-RAM); the file format is already a layer ARRAY so
 * later layers slot in. Saving is EXPLICIT (button / Ctrl+S, ASSET_DOCUMENTS.md
 * §2.5) — a dirty flag drives the editor's save indicator.
 */

/** A brand-new map is one screen (wider comes from painting, S1.B2.T3). */
const NEW_MAP_W = MAP_W
const NEW_MAP_H = MAP_H

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
  const width = ref(NEW_MAP_W)
  const height = ref(NEW_MAP_H)
  const tiles = ref<Uint8Array>(new Uint8Array(NEW_MAP_W * NEW_MAP_H).fill(EMPTY_TILE))
  const colors = ref<Uint8Array>(new Uint8Array(NEW_MAP_W * NEW_MAP_H).fill(DEFAULT_COLOR_RAM))
  const version = ref(0)
  const dirty = ref(false)

  /** Resize to a blank map of w×h cells (load / new / clear all go through here, so
   *  the two grids and the two dimensions can never disagree). */
  function resetTo(w: number, h: number): void {
    width.value = w
    height.value = h
    tiles.value = new Uint8Array(w * h).fill(EMPTY_TILE)
    colors.value = new Uint8Array(w * h).fill(DEFAULT_COLOR_RAM)
    version.value++
  }

  /**
   * Widen the level to `newWidth` columns, keeping everything painted (S1.B2.T3). The
   * grid is row-major, so a wider map is NOT the old array with cells appended — every
   * row moves to a new stride. Copy row by row, or the level would shear.
   *
   * Growing only ever adds empty land on the right; it never shrinks (a level shortened
   * by accident would take painted work with it — that stays a deliberate act, not a
   * side effect of the mouse wandering).
   */
  function growTo(newWidth: number): void {
    const w = Math.min(MAX_MAP_W, Math.floor(newWidth))
    if (w <= width.value) return
    const h = height.value
    const nextTiles = new Uint8Array(w * h).fill(EMPTY_TILE)
    const nextColors = new Uint8Array(w * h).fill(DEFAULT_COLOR_RAM)
    for (let row = 0; row < h; row++) {
      nextTiles.set(tiles.value.subarray(row * width.value, (row + 1) * width.value), row * w)
      nextColors.set(colors.value.subarray(row * width.value, (row + 1) * width.value), row * w)
    }
    width.value = w
    tiles.value = nextTiles
    colors.value = nextColors
    version.value++
    dirty.value = true
  }

  // The project this map belongs to (set on load). Saves target this dir.
  let projectDir: string | null = null
  let assetRel: string = TILEMAP_FILE

  /** Is this cell inside the map? */
  function inside(col: number, row: number): boolean {
    return col >= 0 && col < width.value && row >= 0 && row < height.value
  }

  /** The tile number at a cell (EMPTY_TILE = blank Space). */
  function tileAt(col: number, row: number): number {
    if (!inside(col, row)) return EMPTY_TILE
    return tiles.value[row * width.value + col]
  }

  /** The Color-RAM colour (0–15) at a cell. */
  function colorAt(col: number, row: number): number {
    if (!inside(col, row)) return DEFAULT_COLOR_RAM
    return colors.value[row * width.value + col]
  }

  /** Paint one cell with a tile number AND its Color-RAM colour (the free MC colour
   *  for that 8×8 cell). Marks dirty only — saving is EXPLICIT. No-op if unchanged. */
  function setTile(col: number, row: number, n: number, color: number): void {
    if (!inside(col, row)) return
    const i = row * width.value + col
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
    resetTo(NEW_MAP_W, NEW_MAP_H)
    dirty.value = false
    if (!rel) return // no tilemap asset yet — start empty
    const text = await window.breadcraft.assets.read(dir, rel)
    if (!text) return
    const parsed = parseTilemap(text)
    if (parsed) {
      // The FILE decides the size — a pre-B2 map is one screen, a scrolling world wider.
      width.value = parsed.width
      height.value = parsed.height
      tiles.value = parsed.tiles
      colors.value = parsed.colors
      version.value++
    }
  }

  /** The map exactly as it stands — grids plus their size, the shape the file wants. */
  function snapshot(): {
    tiles: Uint8Array
    colors: Uint8Array
    width: number
    height: number
  } {
    return { tiles: tiles.value, colors: colors.value, width: width.value, height: height.value }
  }

  /** Write the tilemap to disk (explicit save: button / Ctrl+S). */
  async function save(): Promise<void> {
    if (!projectDir) return
    const text = serializeTilemap(snapshot())
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
    resetTo(NEW_MAP_W, NEW_MAP_H)
    dirty.value = false
    const text = serializeTilemap(snapshot())
    await window.breadcraft.assets.write(dir, 'tilemap', rel, text)
  }

  /** Empty the whole map in one step (T1): every cell back to Space (EMPTY_TILE) +
   *  the default Color-RAM colour. Destructive and there is no undo yet, so the editor
   *  guards this behind a confirm dialog. A new array identity triggers a full redraw. */
  function clear(): void {
    // Empties the map, does NOT resize it — a five-screen level stays five screens wide.
    resetTo(width.value, height.value)
    dirty.value = true
  }

  /** "Save as" (P2.T0b): bind to a new rel and write the CURRENT map there. */
  async function saveTo(dir: string, rel: string): Promise<void> {
    projectDir = dir
    assetRel = rel
    const text = serializeTilemap(snapshot())
    await window.breadcraft.assets.write(dir, 'tilemap', rel, text)
    dirty.value = false
  }

  return {
    width,
    height,
    tiles,
    colors,
    version,
    dirty,
    tileAt,
    colorAt,
    setTile,
    growTo,
    clear,
    loadForProject,
    save,
    currentRel,
    switchAsset,
    createBlank,
    saveTo
  }
})

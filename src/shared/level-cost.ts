/**
 * What a scrolling level costs in C64 RAM, and WHY (S1.B3.1). One truth for both sides:
 * the map editor's counter and the transpiler's bake ask this same module, so the number
 * you feel while painting is the number the machine actually pays.
 *
 * The engine reads the world COLUMN by column (a coarse scroll step reveals one column),
 * so a level is stored column-major: for every map column, the tiles of the play-field
 * band, one after the other.
 *
 * COLOUR is where the honest choice sits. The C64's Color-RAM is per CELL, so painting
 * every cell its own colour is allowed — it just costs a second byte per cell:
 *
 *   - `tileTable`  — every tile number is painted in ONE colour throughout the level, so
 *                    a 256-byte table "tile → colour" says it all: 1 byte per cell.
 *                    A screen of level ≈ 400 bytes.
 *   - `perCell`    — at least one tile appears in two colours (the painter used the
 *                    freedom the C64 offers), so the colour travels with the cell:
 *                    2 bytes per cell. A screen of level ≈ 800 bytes.
 *
 * The model is CHOSEN, never imposed: paint freely and the level costs what it costs;
 * paint one colour per tile and it halves by itself. Nothing is forbidden, the price is
 * simply told (memory: breadcraft-limits-philosophy).
 */

/** The 256-byte tile → colour table the cheap model needs. */
export const TILE_COLOR_TABLE = 256

export type ColorModel = 'tileTable' | 'perCell'

export interface LevelCost {
  model: ColorModel
  /** Bytes the whole level costs (column data + table, if any). */
  bytes: number
  /** Tiles painted in more than one colour — why the per-cell model was needed. Empty
   *  for `tileTable`. Sorted, so a message about them reads the same every time. */
  conflictTiles: number[]
  /** tile → colour, only for `tileTable` (index = tile number, 0–255). */
  tileColors: Uint8Array | null
}

export interface LevelShape {
  /** Row-major cells as the editor stores them (cell = row * width + col). */
  tiles: Uint8Array | number[]
  colors: Uint8Array | number[]
  width: number
  /** First screen row of the play field. */
  bandTop: number
  /** How many rows the play field is tall. */
  bandRows: number
}

/**
 * Which colour model this painted level needs, and what it costs. Only the cells inside
 * the play-field band count — rows outside it stand still and are not level data at all.
 */
export function levelCost(shape: LevelShape, mapHeight: number): LevelCost {
  const { tiles, colors, width, bandTop, bandRows } = shape
  const cells = width * bandRows
  // tile → the colour it was first seen in; -1 = not seen yet.
  const seen = new Int16Array(256).fill(-1)
  const conflicts = new Set<number>()

  for (let row = bandTop; row < bandTop + bandRows && row < mapHeight; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const tile = tiles[i] & 0xff
      const color = colors[i] & 0x0f
      if (seen[tile] < 0) seen[tile] = color
      else if (seen[tile] !== color) conflicts.add(tile)
    }
  }

  if (conflicts.size > 0) {
    return {
      model: 'perCell',
      bytes: cells * 2,
      conflictTiles: [...conflicts].sort((a, b) => a - b),
      tileColors: null
    }
  }

  const tileColors = new Uint8Array(256)
  for (let t = 0; t < 256; t++) tileColors[t] = seen[t] < 0 ? 0 : seen[t]
  return {
    model: 'tileTable',
    bytes: cells + TILE_COLOR_TABLE,
    conflictTiles: [],
    tileColors
  }
}

/** Bytes one screen of level costs under a model — the unit the counter counts in. */
export function bytesPerScreen(model: ColorModel, screenW: number, bandRows: number): number {
  return screenW * bandRows * (model === 'perCell' ? 2 : 1)
}

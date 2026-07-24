/**
 * What a level COSTS, in the units a level designer thinks in (S1.B2.T3). The numbers
 * come from the scrolling engine measured on real hardware (S1 T4, `_intern/SCROLLING_PLAN.md`),
 * so the editor's counter and the later RAM bar tell the same story — costs felt while
 * painting, not discovered at build time.
 *
 * The honest map model of the engine: one byte per cell of the scrolling band, plus a
 * 256-byte table saying which colour each TILE has (colour belongs to the tile, not the
 * cell). So bytes = columns × band rows + 256, and one screen of level ≈ 400 bytes.
 */

/** Tile rows that still scroll smoothly (measured ceiling, T4: above this the C64 chases
 *  the beam and loses). The band's real height comes from `PlayField` in the source — the
 *  editor knows nothing about the source, so the counter reckons with the ceiling. */
export const BAND_ROWS = 10
/** The tile → colour table baked next to every level. */
export const TILE_COLOR_TABLE = 256
/** Room set aside for level data. The machine has ~44 KB free after program, screen and
 *  charset (T4); this leaves the lion's share of it to the game itself. */
export const LEVEL_BUDGET = 16 * 1024

/** Bytes a level of `columns` columns costs on the C64. A taller play field stores more
 *  per column, so the band's height is what the level is really paid for (S1.B2.T4). */
export function levelBytes(columns: number, bandRows: number = BAND_ROWS): number {
  return columns * bandRows + TILE_COLOR_TABLE
}

/** Bytes one screen of level costs (~400 at the ten-row band) — the counter's unit. */
export function bytesPerScreen(screenW: number, bandRows: number = BAND_ROWS): number {
  return screenW * bandRows
}

/** How many further screens fit in the budget (never negative). */
export function screensLeft(
  columns: number,
  screenW: number,
  bandRows: number = BAND_ROWS
): number {
  const left = LEVEL_BUDGET - levelBytes(columns, bandRows)
  return Math.max(0, Math.floor(left / bytesPerScreen(screenW, bandRows)))
}

/** The level's length in screens, one decimal — "3.5 screens long" is how a level reads. */
export function levelScreens(columns: number, screenW: number): number {
  return Math.round((columns / screenW) * 10) / 10
}

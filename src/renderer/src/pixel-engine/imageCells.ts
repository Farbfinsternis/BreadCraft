/**
 * Multicolor-bitmap CELL logic — the C64 truth that makes the Image editor more
 * than a DPaint clone (BRONZE B2.T2a, memory breadcraft-imageeditor-color-clash).
 *
 * The image is a flat 16-colour-per-pixel buffer (row-major, one value 0–15 per
 * logical MC pixel — the "Free mode" home turf, all 16 colours, no limit). The
 * real C64 can't show that freely: the 160×200 MC bitmap is divided into 40×25
 * character cells of CELL_W×CELL_H logical pixels, and EACH cell may show only
 * the ONE global background colour plus up to 3 cell-own colours.
 *
 * This module answers "how many colours does this cell use?" (the per-cell budget
 * readout + clash counter) and, for C64-true mode, "how do I force this cell back
 * within budget?" (reconcile). Pure + headless (no Vue, no canvas), so the rule is
 * Vitest-provable exactly like charsetBytes / spriteBytes.
 */

/** MC logical pixels across one character cell (= 8 hi-res px; MC pixels are double-wide). */
export const CELL_W = 4
/** Rows of pixels in one character cell. */
export const CELL_H = 8
/** Cell-own colours a cell may show BEYOND the shared global background. */
export const MAX_CELL_COLORS = 3

export interface Cell {
  col: number
  row: number
}

/** Which character cell a logical pixel lives in. */
export function cellOf(x: number, y: number): Cell {
  return { col: Math.floor(x / CELL_W), row: Math.floor(y / CELL_H) }
}

/**
 * The distinct NON-background colours a cell uses, most-used first. Length is the
 * cell's "colour spend": ≤ MAX_CELL_COLORS is C64-legal, more is a clash.
 */
export function cellColors(
  buf: Uint8Array,
  W: number,
  col: number,
  row: number,
  bg: number
): number[] {
  const counts = new Map<number, number>()
  const x0 = col * CELL_W
  const y0 = row * CELL_H
  for (let dy = 0; dy < CELL_H; dy++) {
    for (let dx = 0; dx < CELL_W; dx++) {
      const c = buf[(y0 + dy) * W + (x0 + dx)]
      if (c === bg) continue
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
}

/** True if a cell shows more colours than the C64 can (global bg + more than 3 own). */
export function cellOverBudget(
  buf: Uint8Array,
  W: number,
  col: number,
  row: number,
  bg: number
): boolean {
  return cellColors(buf, W, col, row, bg).length > MAX_CELL_COLORS
}

/** How many cells in the whole image break the C64 budget (the honest clash counter). */
export function countClashCells(buf: Uint8Array, W: number, H: number, bg: number): number {
  let n = 0
  const cols = Math.floor(W / CELL_W)
  const rows = Math.floor(H / CELL_H)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (cellOverBudget(buf, W, col, row, bg)) n++
    }
  }
  return n
}

type Rgb = readonly [number, number, number]

function dist2(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

/**
 * C64-true reconcile: force each given cell down to ≤ MAX_CELL_COLORS cell-own
 * colours. Keeps the most-used colours; every pixel of an evicted colour is
 * remapped to the nearest KEPT colour by RGB distance (the global background is
 * always an available target). Returns the pixel writes to apply — the caller
 * folds them into the same undo step, so a paint and its cell-fix land together.
 *
 * This is Multipaint's "intelligent colour adaptation": painting never blocks; a
 * fourth colour snaps to the closest one the cell can still afford.
 */
export function reconcileCells(
  buf: Uint8Array,
  W: number,
  cells: readonly Cell[],
  bg: number,
  rgb: readonly Rgb[]
): { x: number; y: number; value: number }[] {
  const writes: { x: number; y: number; value: number }[] = []
  const seen = new Set<number>()
  for (const { col, row } of cells) {
    const key = row * 10000 + col
    if (seen.has(key)) continue
    seen.add(key)

    const used = cellColors(buf, W, col, row, bg) // most-used first
    if (used.length <= MAX_CELL_COLORS) continue

    const keep = used.slice(0, MAX_CELL_COLORS)
    const evicted = used.slice(MAX_CELL_COLORS)
    const targets = [...keep, bg]

    const remap = new Map<number, number>()
    for (const c of evicted) {
      let best = bg
      let bestD = Infinity
      for (const t of targets) {
        const d = dist2(rgb[c], rgb[t])
        if (d < bestD) {
          bestD = d
          best = t
        }
      }
      remap.set(c, best)
    }

    const x0 = col * CELL_W
    const y0 = row * CELL_H
    for (let dy = 0; dy < CELL_H; dy++) {
      for (let dx = 0; dx < CELL_W; dx++) {
        const x = x0 + dx
        const y = y0 + dy
        const to = remap.get(buf[y * W + x])
        if (to !== undefined) writes.push({ x, y, value: to })
      }
    }
  }
  return writes
}

/** Enumerate the cells overlapping a pixel bounding box (inclusive), clamped to the image. */
export function cellsInBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  W: number,
  H: number
): Cell[] {
  const cols = Math.floor(W / CELL_W)
  const rows = Math.floor(H / CELL_H)
  const c0 = Math.max(0, Math.floor(Math.min(x0, x1) / CELL_W))
  const c1 = Math.min(cols - 1, Math.floor(Math.max(x0, x1) / CELL_W))
  const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / CELL_H))
  const r1 = Math.min(rows - 1, Math.floor(Math.max(y0, y1) / CELL_H))
  const out: Cell[] = []
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) out.push({ col, row })
  }
  return out
}

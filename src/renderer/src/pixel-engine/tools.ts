/**
 * Pixel tools — pure grid algorithms (memory breadcraft-pixel-engine,
 * PETSCII_EDITOR.md §8.2). Each tool mutates the grid and returns the list of
 * CellChanges it made, so the caller can both render the delta and push one undo
 * step. No Vue, no colours, no pixelAspect — the algorithms operate on the
 * abstract grid; WYSIWYG (1:1 vs 2:1) is the renderer's job, not theirs.
 */

import type { CellChange, PixelGrid, PixelIndex } from './grid'

/** Set a single cell. */
export function drawPixel(grid: PixelGrid, x: number, y: number, value: PixelIndex): CellChange[] {
  const change = grid.set(x, y, value)
  return change ? [change] : []
}

/** Bresenham line from (x0,y0) to (x1,y1), inclusive. */
export function line(
  grid: PixelGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: PixelIndex
): CellChange[] {
  const changes: CellChange[] = []
  let dx = Math.abs(x1 - x0)
  let dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0
  let y = y0
  // Guard against pathological huge grids: max steps = perimeter-ish.
  for (;;) {
    const c = grid.set(x, y, value)
    if (c) changes.push(c)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return changes
}

/**
 * Rectangle from corner (x0,y0) to (x1,y1), inclusive. `fill=false` draws the
 * outline only; `fill=true` fills the interior too.
 */
export function rect(
  grid: PixelGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: PixelIndex,
  fill: boolean
): CellChange[] {
  const changes: CellChange[] = []
  const left = Math.min(x0, x1)
  const right = Math.max(x0, x1)
  const top = Math.min(y0, y1)
  const bottom = Math.max(y0, y1)
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const onEdge = x === left || x === right || y === top || y === bottom
      if (fill || onEdge) {
        const c = grid.set(x, y, value)
        if (c) changes.push(c)
      }
    }
  }
  return changes
}

/**
 * Flood-fill the 4-connected region of cells sharing the starting cell's index,
 * replacing them with `value`. No-op if the start already equals `value`.
 */
export function fill(grid: PixelGrid, x: number, y: number, value: PixelIndex): CellChange[] {
  if (!grid.inBounds(x, y)) return []
  const target = grid.get(x, y)
  if (target === value) return []

  const changes: CellChange[] = []
  const stack: Array<[number, number]> = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop() as [number, number]
    if (!grid.inBounds(cx, cy)) continue
    if (grid.get(cx, cy) !== target) continue
    const c = grid.set(cx, cy, value)
    if (c) changes.push(c)
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
  return changes
}

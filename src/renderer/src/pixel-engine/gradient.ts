/**
 * Line-based dithered gradient (BRONZE B2.T2b) — the planner behind the image editor's
 * gradient tool. Unlike a box gradient, the DIRECTION and the FILLED AREA are separate:
 *
 *   - a LINE (x0,y0)→(x1,y1) sets the gradient's angle and length (`from` at the line's
 *     start, `to` at its end; beyond either end the colour clamps to pure from/to), and
 *   - a REGION (a rectangle, or the whole image when nothing is selected) says WHERE it
 *     lands.
 *
 * This mirrors a pro tool's linear-gradient: drag a line at any angle, and the selection
 * (or the whole canvas) fills along it. Pure + headless — it returns the writes to apply
 * (like reconcileCells), so the caller folds them into one undo step and the maths is
 * Vitest-provable without a grid, a canvas, or Vue.
 */
import { ditherThreshold } from './dither'

export interface Region {
  /** Inclusive pixel bounds. */
  left: number
  top: number
  right: number
  bottom: number
}

export interface PixelWrite {
  x: number
  y: number
  value: number
}

/**
 * Plan a dithered linear gradient over `region`, projected onto the line (x0,y0)→(x1,y1).
 * `from` paints the line's start, `to` its end; the 4×4 Bayer dither fakes the in-between
 * shades with those two colours only. A zero-length line fills the whole region with
 * `from`. Returns one write per region pixel (the caller skips no-ops via grid.set).
 */
export function planGradient(
  region: Region,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  from: number,
  to: number
): PixelWrite[] {
  const writes: PixelWrite[] = []
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  for (let y = region.top; y <= region.bottom; y++) {
    for (let x = region.left; x <= region.right; x++) {
      // Fraction along the gradient line (0 at the start, 1 at the end), clamped so
      // pixels before/after the line stay pure `from`/`to`.
      let t = len2 === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2
      if (t < 0) t = 0
      else if (t > 1) t = 1
      writes.push({ x, y, value: t > ditherThreshold(x, y) ? to : from })
    }
  }
  return writes
}

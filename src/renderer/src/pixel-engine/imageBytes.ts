/**
 * Image byte conversion (BRONZE B2.T2) — the bridge between the editor's canvas and
 * the C64 MC-bitmap hardware layout, the analog of charsetBytes / spriteBytes.
 *
 * The editor paints a flat 16-colour-per-pixel buffer (160×200, one value 0–15 per
 * logical MC pixel). The C64 stores the SAME picture as three byte planes + a shared
 * background (what `.image` holds and `UseImage`/`DrawImage` bake):
 *   - bitmap  8000 B — 1000 char cells × 8 rows, 2 bits per double-wide pixel.
 *   - screen  1000 B — per cell: %01 colour (hi nibble) + %10 colour (lo nibble).
 *   - color   1000 B — per cell: %11 colour (lo nibble).
 * with pattern %00 = the global background.
 *
 * `bufferToC64` assumes each cell is already C64-legal (≤ 3 non-background colours —
 * the caller reconciles first, e.g. imageCells.reconcileCells); a stray 4th colour
 * falls back to the background rather than corrupting a neighbour. Pure + headless,
 * so the packing is Vitest-provable.
 */
import { CELL_W, CELL_H, cellColors } from './imageCells'

export const IMG_W = 160
export const IMG_H = 200
export const IMG_CELLS_X = IMG_W / CELL_W // 40
export const IMG_CELLS_Y = IMG_H / CELL_H // 25
export const IMG_BITMAP_BYTES = IMG_CELLS_X * IMG_CELLS_Y * CELL_H // 8000
export const IMG_SCREEN_BYTES = IMG_CELLS_X * IMG_CELLS_Y // 1000
export const IMG_COLOR_BYTES = IMG_CELLS_X * IMG_CELLS_Y // 1000

export interface C64Bitmap {
  bitmap: Uint8Array
  screen: Uint8Array
  color: Uint8Array
}

/** Pack the 16-colour canvas into the three C64 byte planes (background = pattern %00). */
export function bufferToC64(buf: Uint8Array, bg: number): C64Bitmap {
  const bitmap = new Uint8Array(IMG_BITMAP_BYTES)
  const screen = new Uint8Array(IMG_SCREEN_BYTES)
  const color = new Uint8Array(IMG_COLOR_BYTES)

  for (let cy = 0; cy < IMG_CELLS_Y; cy++) {
    for (let cx = 0; cx < IMG_CELLS_X; cx++) {
      const cell = cy * IMG_CELLS_X + cx
      // Most-used-first, so the dominant colours take the low-cost slots and a stray
      // 4th (illegal input) is the one dropped, not a heavily-used colour.
      const cols = cellColors(buf, IMG_W, cx, cy, bg)
      const s1 = cols[0] ?? 0
      const s2 = cols[1] ?? 0
      const s3 = cols[2] ?? 0
      screen[cell] = ((s1 & 0x0f) << 4) | (s2 & 0x0f)
      color[cell] = s3 & 0x0f

      for (let row = 0; row < CELL_H; row++) {
        let b = 0
        for (let col = 0; col < CELL_W; col++) {
          const c = buf[(cy * CELL_H + row) * IMG_W + (cx * CELL_W + col)]
          let code = 0
          if (c !== bg) {
            if (c === s1) code = 1
            else if (c === s2) code = 2
            else if (c === s3) code = 3
            // else: a 4th colour in a not-yet-reconciled cell → %00 (background).
          }
          b |= code << ((CELL_W - 1 - col) * 2)
        }
        bitmap[cell * CELL_H + row] = b
      }
    }
  }
  return { bitmap, screen, color }
}

/** Unpack the three C64 byte planes back into the 16-colour canvas. */
export function c64ToBuffer(
  bitmap: Uint8Array,
  screen: Uint8Array,
  color: Uint8Array,
  bg: number
): Uint8Array {
  const buf = new Uint8Array(IMG_W * IMG_H)
  for (let cy = 0; cy < IMG_CELLS_Y; cy++) {
    for (let cx = 0; cx < IMG_CELLS_X; cx++) {
      const cell = cy * IMG_CELLS_X + cx
      const slots = [bg, screen[cell] >> 4, screen[cell] & 0x0f, color[cell] & 0x0f]
      for (let row = 0; row < CELL_H; row++) {
        const b = bitmap[cell * CELL_H + row]
        for (let col = 0; col < CELL_W; col++) {
          const code = (b >> ((CELL_W - 1 - col) * 2)) & 0x03
          buf[(cy * CELL_H + row) * IMG_W + (cx * CELL_W + col)] = slots[code]
        }
      }
    }
  }
  return buf
}

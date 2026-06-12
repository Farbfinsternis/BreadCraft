/**
 * Conversion between the editor's pixel-index model (0–3 per pixel, the engine's
 * data model) and the raw 63-bytes-per-sprite C64 hardware layout that the
 * `.sprite` file stores. Parallel to charsetBytes.ts (the 8×8 charset path), but
 * for the VIC sprite shape: 24×21 visible pixels, 3 bytes per row × 21 rows = 63.
 *
 * Same bit conventions as the charset path so both formats read alike:
 *   - The most-significant bit is the leftmost pixel (classic C64 bit order).
 *   - byte[0] is the top-left, bytes run row-major (3 per row, top row first).
 * The C64 reads only the first 63 of the 64-byte sprite block; we store 63.
 *
 * HI-RES path: 1 bit per pixel, 24 pixels per row = 3 bytes.
 *   - index 0 → clear (transparent), any non-zero index → set. The single sprite
 *     colour ($D027+n) is applied by the hardware, not stored per-pixel.
 *
 * MULTICOLOR path: 2 bits per double-pixel, 12 double-pixels per row = 3 bytes.
 *   - The MC index grid is 12 wide × 21 high (252 cells): one cell per double-
 *     pixel, value 0–3 = the C64 colour source (0 transparent, 1 spr-mcolor0
 *     shared, 2 sprite colour individual, 3 spr-mcolor1 shared). NOTE the C64's
 *     MC bit-pair meaning differs from the charset's, but the PACKING is identical
 *     (index IS the 2-bit pair, leftmost double-pixel = MSB pair) → lossless 0–3.
 */

const WIDTH = 24
const HEIGHT = 21
const BYTES_PER_ROW = 3
export const SPRITE_BYTES = BYTES_PER_ROW * HEIGHT // 63
export const SPRITE_HIRES_CELLS = WIDTH * HEIGHT // 504

const MC_WIDTH = 12 // 12 double-pixels per row
export const SPRITE_MC_CELLS = MC_WIDTH * HEIGHT // 252

/**
 * Pack a 504-cell hi-res sprite index grid (24×21, row-major, values 0–3) into
 * 63 C64 bytes (3 per row, bit 7 of byte 0 = top-left pixel). Any non-zero index
 * counts as "set" (hi-res sprite is 1-bit), so an MC-drawn grid still packs.
 */
export function indicesToBytesSpriteHires(cells: Uint8Array | number[]): Uint8Array {
  const bytes = new Uint8Array(SPRITE_BYTES)
  for (let y = 0; y < HEIGHT; y++) {
    for (let bx = 0; bx < BYTES_PER_ROW; bx++) {
      let b = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit
        const idx = cells[y * WIDTH + x] ?? 0
        if (idx !== 0) b |= 1 << (7 - bit) // MSB = leftmost pixel of this byte
      }
      bytes[y * BYTES_PER_ROW + bx] = b
    }
  }
  return bytes
}

/**
 * Unpack 63 C64 bytes into a 504-cell hi-res sprite index grid (values 0/1). A
 * set bit becomes index 1 (foreground), a clear bit index 0 (transparent).
 */
export function bytesToIndicesSpriteHires(bytes: Uint8Array | number[]): Uint8Array {
  const cells = new Uint8Array(SPRITE_HIRES_CELLS)
  for (let y = 0; y < HEIGHT; y++) {
    for (let bx = 0; bx < BYTES_PER_ROW; bx++) {
      const b = bytes[y * BYTES_PER_ROW + bx] ?? 0
      for (let bit = 0; bit < 8; bit++) {
        cells[y * WIDTH + bx * 8 + bit] = (b >> (7 - bit)) & 1
      }
    }
  }
  return cells
}

/**
 * Pack a 252-cell multicolor sprite index grid (12 wide × 21 high, row-major,
 * values 0–3) into 63 C64 bytes. Each row is 3 bytes = 12 double-pixels; the
 * leftmost double-pixel of a byte is bits 7–6, the rightmost bits 1–0. The index
 * is stored unchanged as its 2-bit pair → indices 2/3 survive (lossless).
 */
export function indicesToBytesSpriteMC(cells: Uint8Array | number[]): Uint8Array {
  const bytes = new Uint8Array(SPRITE_BYTES)
  for (let y = 0; y < HEIGHT; y++) {
    for (let bx = 0; bx < BYTES_PER_ROW; bx++) {
      let b = 0
      for (let dp = 0; dp < 4; dp++) {
        const cx = bx * 4 + dp
        const idx = (cells[y * MC_WIDTH + cx] ?? 0) & 0b11
        b |= idx << (6 - 2 * dp) // dp=0 → bits 7–6 (leftmost), dp=3 → bits 1–0
      }
      bytes[y * BYTES_PER_ROW + bx] = b
    }
  }
  return bytes
}

/**
 * Unpack 63 C64 bytes into a 252-cell multicolor sprite index grid (values 0–3).
 * The inverse of indicesToBytesSpriteMC: each 2-bit pair becomes one double-pixel.
 */
export function bytesToIndicesSpriteMC(bytes: Uint8Array | number[]): Uint8Array {
  const cells = new Uint8Array(SPRITE_MC_CELLS)
  for (let y = 0; y < HEIGHT; y++) {
    for (let bx = 0; bx < BYTES_PER_ROW; bx++) {
      const b = bytes[y * BYTES_PER_ROW + bx] ?? 0
      for (let dp = 0; dp < 4; dp++) {
        cells[y * MC_WIDTH + bx * 4 + dp] = (b >> (6 - 2 * dp)) & 0b11
      }
    }
  }
  return cells
}

/** Cells in one sprite frame's index grid for the given mode (hi-res 504 / MC 252). */
export function pixelsPerSprite(mode: 'TEXT_HIRES' | 'TEXT_MULTICOLOR' | string): number {
  return mode === 'TEXT_MULTICOLOR' ? SPRITE_MC_CELLS : SPRITE_HIRES_CELLS
}

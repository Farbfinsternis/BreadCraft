/**
 * Conversion between the editor's pixel-index model (0–3 per pixel, the engine's
 * data model) and the raw 8-bytes-per-character C64 charset layout that the
 * `.petscii` file stores (PETSCII_FORMAT.md §1, ASSET_IO.md §3.1).
 *
 * The `.petscii` file is the C64 truth — 8 raw bytes per char, mode-independent —
 * so the editor's index grid is packed to bytes on save and unpacked on load.
 *
 * HI-RES path (this version): 1 bit per pixel, 8 pixels per row = 1 byte.
 *   - index 0 → bit 0 (background), index 1 → bit 1 (foreground).
 *   - The most-significant bit is the leftmost pixel (classic C64 bit order).
 *   - indices 2/3 don't occur in hi-res; they're clamped to 1 (set) on pack.
 *
 * MULTICOLOR path (this version): 2 bits per double-pixel, 4 double-pixels per
 * row = 1 byte (PETSCII_FORMAT.md §1.1, the normative MC packing).
 *   - The MC index grid is 4 wide × 8 high (32 cells): one cell per double-pixel,
 *     value 0–3 = the C64 colour source (0 bg, 1 shared-1, 2 shared-2, 3 colour-RAM).
 *   - The index IS the 2-bit pair, stored unchanged → lossless round-trip for 0–3
 *     (this is the fix for the MC data-loss bug: hi-res collapsed indices 2/3).
 *   - Leftmost double-pixel = most-significant pair (bits 7–6), same MSB-is-left
 *     convention as the hi-res path; byte[0] = top row.
 */

const WIDTH = 8
const HEIGHT = 8
const PIXELS = WIDTH * HEIGHT // 64

const MC_WIDTH = 4 // 4 double-pixels per row
const MC_PIXELS = MC_WIDTH * HEIGHT // 32

/**
 * Pack a 64-cell hi-res index grid (row-major, values 0–3) into 8 C64 bytes.
 * Each byte is one row; bit 7 = leftmost pixel. Any non-zero index counts as
 * "set" (hi-res is 1-bit), so a grid drawn in MC still packs sensibly in hi-res.
 */
export function indicesToBytesHires(cells: Uint8Array | number[]): Uint8Array {
  const bytes = new Uint8Array(HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    let b = 0
    for (let x = 0; x < WIDTH; x++) {
      const idx = cells[y * WIDTH + x] ?? 0
      if (idx !== 0) b |= 1 << (7 - x) // MSB = leftmost pixel
    }
    bytes[y] = b
  }
  return bytes
}

/**
 * Unpack 8 C64 bytes into a 64-cell hi-res index grid (values 0/1). A set bit
 * becomes index 1 (foreground), a clear bit index 0 (background).
 */
export function bytesToIndicesHires(bytes: Uint8Array | number[]): Uint8Array {
  const cells = new Uint8Array(PIXELS)
  for (let y = 0; y < HEIGHT; y++) {
    const b = bytes[y] ?? 0
    for (let x = 0; x < WIDTH; x++) {
      cells[y * WIDTH + x] = (b >> (7 - x)) & 1
    }
  }
  return cells
}

/**
 * Pack a 32-cell multicolor index grid (4 wide × 8 high, row-major, values 0–3)
 * into 8 C64 bytes (PETSCII_FORMAT.md §1.1). Each byte is one row of 4 double-
 * pixels; the leftmost (dp=0) is bits 7–6, the rightmost (dp=3) is bits 1–0.
 * The index is stored unchanged as its 2-bit pair → indices 2/3 survive.
 */
export function indicesToBytesMC(cells: Uint8Array | number[]): Uint8Array {
  const bytes = new Uint8Array(HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    let b = 0
    for (let dp = 0; dp < MC_WIDTH; dp++) {
      const idx = (cells[y * MC_WIDTH + dp] ?? 0) & 0b11
      b |= idx << (6 - 2 * dp) // dp=0 → bits 7–6 (leftmost), dp=3 → bits 1–0
    }
    bytes[y] = b
  }
  return bytes
}

/**
 * Unpack 8 C64 bytes into a 32-cell multicolor index grid (values 0–3). The
 * inverse of indicesToBytesMC: each 2-bit pair becomes one double-pixel index.
 */
export function bytesToIndicesMC(bytes: Uint8Array | number[]): Uint8Array {
  const cells = new Uint8Array(MC_PIXELS)
  for (let y = 0; y < HEIGHT; y++) {
    const b = bytes[y] ?? 0
    for (let dp = 0; dp < MC_WIDTH; dp++) {
      cells[y * MC_WIDTH + dp] = (b >> (6 - 2 * dp)) & 0b11
    }
  }
  return cells
}

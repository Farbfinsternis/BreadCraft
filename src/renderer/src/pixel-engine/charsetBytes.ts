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
 * MULTICOLOR packing (2 bits per double-pixel) comes with the graphics-mode SSOT
 * (memory breadcraft-pixel-engine); kept out here until that mode is switched on.
 */

const WIDTH = 8
const HEIGHT = 8
const PIXELS = WIDTH * HEIGHT // 64

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

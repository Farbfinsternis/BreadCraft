/**
 * Charset rendering onto a 2D canvas (BREADCRAFT_IDE.md §3.0.1). The shared way to
 * paint a character from its pixel-INDEX data (0–3) — used by the tilemap map
 * canvas, the tile palette, and the PETSCII navigator. Replaces the copied
 * per-pixel hex-preview logic with one renderer (DRY).
 *
 * Headless: takes a CanvasRenderingContext2D, no Vue, no DOM lookups — the colour
 * mapping + pixel loop are plain logic (Vitest-testable with a fake context).
 *
 * Mode-aware: a character's index grid is 8×8 in hi-res (64 cells, square pixels)
 * or 4×8 in multicolor (32 cells, double-WIDE pixels = 2 C64 pixels each, so a char
 * is always 8 C64 pixels wide). The grid dimensions are passed in (default 8×8 hi-
 * res, backward-compatible). `indexPalette` is the 4 CSS colours (0=bg,1=s1,2=s2,3=
 * free/Color-RAM, PETSCII_FORMAT.md §1.1).
 */

const CHAR_W = 8
const CHAR_H = 8

/** Grid dimensions for a graphics mode: MC = 4 double-pixels wide, hi-res = 8. */
export function charGridDims(multicolor: boolean): { gw: number; gh: number; cellW: number } {
  // cellW = how many C64 pixels one grid cell spans horizontally (MC = 2, hi-res = 1),
  // so a character is always CHAR_W (8) C64 pixels wide regardless of mode.
  return multicolor ? { gw: 4, gh: CHAR_H, cellW: 2 } : { gw: CHAR_W, gh: CHAR_H, cellW: 1 }
}

/** Build the 4-colour palette for one tile, substituting the cell's Color-RAM
 *  colour for index 3 when given (MC only). In the real C64 MC char mode the
 *  bit-pair 11 (index 3) picks the cell's Color-RAM colour, free per 8×8
 *  (PETSCII_FORMAT.md §1.1 / §2.2). Hi-res / no override → palette unchanged. */
export function tilePalette(
  indexPalette: string[],
  multicolor: boolean,
  colorRamHex?: string
): string[] {
  if (!multicolor || !colorRamHex) return indexPalette
  const p = indexPalette.slice()
  p[3] = colorRamHex
  return p
}

/**
 * Draw one character at (dx, dy) scaled by `scale` device pixels per C64 pixel.
 * `indices` is the grid cells (0–3, row-major). In multicolor each cell is drawn
 * `cellW` (=2) C64 pixels wide, so the char stays 8 C64 pixels across. Shorter/
 * empty data reads as background (0). `colorRamHex` (MC only) overrides index 3
 * with this cell's Color-RAM colour. Fills cell by cell with fillRect.
 */
export function drawChar(
  ctx: CanvasRenderingContext2D,
  indices: Uint8Array | number[] | undefined,
  dx: number,
  dy: number,
  scale: number,
  indexPalette: string[],
  multicolor = false,
  colorRamHex?: string
): void {
  const pal = tilePalette(indexPalette, multicolor, colorRamHex)
  const bg = pal[0] ?? '#000'
  const { gw, gh, cellW } = charGridDims(multicolor)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const idx = indices?.[y * gw + x] ?? 0
      ctx.fillStyle = pal[idx] ?? bg
      // x is the cell column; each cell spans cellW C64 pixels horizontally.
      ctx.fillRect(dx + x * cellW * scale, dy + y * scale, cellW * scale, scale)
    }
  }
}

/**
 * The per-C64-pixel CSS colours of a character (always 64 entries = 8×8 C64 pixels),
 * for callers rendering a fixed 8×8 CSS-grid preview. In multicolor each stored cell
 * expands to TWO adjacent entries (the double-wide pixel), so the preview stays an
 * 8×8 square. Mirrors drawChar's mapping so a tile looks identical whichever path
 * renders it.
 */
export function charPixelHexes(
  indices: Uint8Array | number[] | undefined,
  indexPalette: string[],
  multicolor = false
): string[] {
  const bg = indexPalette[0] ?? '#000'
  const { gw, gh, cellW } = charGridDims(multicolor)
  const out: string[] = new Array(CHAR_W * CHAR_H)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const idx = indices?.[y * gw + x] ?? 0
      const hex = indexPalette[idx] ?? bg
      for (let w = 0; w < cellW; w++) out[y * CHAR_W + x * cellW + w] = hex
    }
  }
  return out
}

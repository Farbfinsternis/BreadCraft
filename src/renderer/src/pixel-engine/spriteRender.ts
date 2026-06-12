/**
 * Sprite rendering from its pixel-INDEX data (0–3) — the sprite parallel to
 * charsetRender.ts. Used by the Sprite-Editor's frame-strip mini-previews.
 *
 * Headless: pure index→hex mapping, no Vue/DOM (Vitest-testable).
 *
 * Mode-aware: a sprite frame's index grid is 24×21 in hi-res (504 cells, square
 * pixels) or 12×21 in multicolor (252 cells, double-WIDE pixels = 2 C64 pixels
 * each, so the sprite is always 24 C64 pixels wide). `indexPalette` is the 4 CSS
 * colours (0=transparent/bg, 1=mcolor0, 2=sprite colour, 3=mcolor1).
 */

const SPR_W = 24
const SPR_H = 21
export const SPRITE_PREVIEW_CELLS = SPR_W * SPR_H // 504

/** Grid dimensions for a sprite in a graphics mode: MC = 12 double-pixels wide,
 *  hi-res = 24. cellW = how many C64 pixels one grid cell spans (MC 2 / hi-res 1),
 *  so a sprite is always SPR_W (24) C64 pixels wide regardless of mode. */
export function spriteGridDims(multicolor: boolean): { gw: number; gh: number; cellW: number } {
  return multicolor ? { gw: 12, gh: SPR_H, cellW: 2 } : { gw: SPR_W, gh: SPR_H, cellW: 1 }
}

/**
 * The per-C64-pixel CSS colours of a sprite frame (always 504 = 24×21 C64 pixels),
 * for callers rendering a fixed 24×21 CSS-grid preview. In multicolor each stored
 * cell expands to TWO adjacent entries (the double-wide pixel), so the preview stays
 * 24 C64 pixels across. Index 0 is transparent; the caller decides what to show
 * behind it (a checkerboard / the editor background) — here it just maps to
 * indexPalette[0]. Mirrors the editor's index→colour mapping.
 */
export function spritePixelHexes(
  indices: Uint8Array | number[] | undefined,
  indexPalette: string[],
  multicolor = false
): string[] {
  const bg = indexPalette[0] ?? '#000'
  const { gw, gh, cellW } = spriteGridDims(multicolor)
  const out: string[] = new Array(SPR_W * SPR_H)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const idx = indices?.[y * gw + x] ?? 0
      const hex = indexPalette[idx] ?? bg
      for (let w = 0; w < cellW; w++) out[y * SPR_W + x * cellW + w] = hex
    }
  }
  return out
}

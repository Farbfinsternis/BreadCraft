/**
 * The `.image` format (BRONZE B2.T1): one C64 Multicolor BITMAP screen, stored as
 * the four raw pieces the VIC needs — exactly what `UseImage`/`DrawImage` bake and
 * copy (Screen-RAM nibbles, Color-RAM, the shared background). The stored bytes ARE
 * C64 truth (the editor packs its 16-colour canvas down to this legal shape on save):
 *
 *   - bitmap  8000 B — 1000 cells × 8 rows, 2 bits per double-wide MC pixel.
 *   - screen  1000 B — per cell: %01 colour (hi nibble) + %10 colour (lo nibble).
 *   - color   1000 B — per cell: %11 colour (lo nibble = the free 4th colour).
 *   - background 1 B — the ONE shared colour ($D021), pattern %00, index 0–15.
 *
 * This module owns the on-disk SHAPE only. Element ranges/lengths are the caller's
 * policy (editor tolerates, build resolver throws), mirroring charset.ts / sprite.ts.
 */
import { AssetFormatError } from './error'
import { formatMessages, DEFAULT_FORMAT_LOCALE, type Locale } from './messages'

export const IMAGE_FORMAT = 'breadcraft.image'
/** MC bitmap: 320×200 = 8000 bytes (1000 char cells × 8 rows). */
export const IMAGE_BITMAP_BYTES = 8000
/** Screen RAM: one byte per cell (two of the three cell colours, packed as nibbles). */
export const IMAGE_SCREEN_BYTES = 1000
/** Color RAM: one byte per cell (the third cell colour, low nibble). */
export const IMAGE_COLOR_BYTES = 1000
/** The shared background colour default (black, C64 index 0) for files predating it. */
export const DEFAULT_IMAGE_BACKGROUND = 0

/** The four pieces exactly as found on disk (raw, un-validated). Callers clamp/validate. */
export interface ImageRaw {
  bitmap: number[]
  screen: number[]
  color: number[]
  /** Whatever the file holds (or undefined for pre-background files) — clamping is the caller's. */
  background: unknown
}

/** Serialize one MC-bitmap screen to the `.image` JSON. Callers pass already-packed
 *  raw C64 bytes (the editor packs its canvas to the legal 4-colour-per-cell shape). */
export function serializeImage(
  bitmap: number[],
  screen: number[],
  color: number[],
  background: number
): string {
  return JSON.stringify({
    format: IMAGE_FORMAT,
    version: 1,
    background,
    bitmap,
    screen,
    color
  })
}

/**
 * Structurally parse a `.image`: valid JSON with `bitmap`, `screen` and `color`
 * arrays present. Returns the raw arrays + raw background untouched (the caller
 * validates lengths, byte ranges and the background index). Throws AssetFormatError
 * on a structural problem (the message is a predicate phrase for the caller to prefix).
 */
export function parseImage(text: string, locale: Locale = DEFAULT_FORMAT_LOCALE): ImageRaw {
  const M = formatMessages(locale)
  let raw: { bitmap?: unknown; screen?: unknown; color?: unknown; background?: unknown }
  try {
    raw = JSON.parse(text) as {
      bitmap?: unknown
      screen?: unknown
      color?: unknown
      background?: unknown
    }
  } catch {
    throw new AssetFormatError(M.jsonBroken('.image'))
  }
  if (!Array.isArray(raw.bitmap)) throw new AssetFormatError(M.noField('bitmap'))
  if (!Array.isArray(raw.screen)) throw new AssetFormatError(M.noField('screen'))
  if (!Array.isArray(raw.color)) throw new AssetFormatError(M.noField('color'))
  return {
    bitmap: raw.bitmap as number[],
    screen: raw.screen as number[],
    color: raw.color as number[],
    background: raw.background
  }
}

/**
 * The `.palette` format (PALETTE_FORMAT.md): the project's three SHARED C64 colour
 * registers (background = bgcolor0, shared1/2 = bgcolor1/2). This module owns the
 * on-disk SHAPE; the value policy differs by side (editor clamps each field to a
 * readable default, build throws on a bad index — see Befund 21 for the still-open
 * unification of the default trio).
 */
import { AssetFormatError } from './error'
import { formatMessages, DEFAULT_FORMAT_LOCALE, type Locale } from './messages'

export const PALETTE_FORMAT = 'breadcraft.palette'

/** The three shared indices exactly as found on disk (raw, un-validated). */
export interface PaletteRaw {
  background: unknown
  shared1: unknown
  shared2: unknown
}

export function serializePalette(p: { background: number; shared1: number; shared2: number }): string {
  return JSON.stringify({ format: PALETTE_FORMAT, version: 1, ...p }, null, 2)
}

/**
 * Structurally parse a `.palette`: valid JSON. Returns the three raw fields; range
 * checks (0–15) are the caller's policy. Throws AssetFormatError on broken JSON.
 */
export function parsePalette(text: string, locale: Locale = DEFAULT_FORMAT_LOCALE): PaletteRaw {
  let raw: PaletteRaw
  try {
    raw = JSON.parse(text) as PaletteRaw
  } catch {
    throw new AssetFormatError(formatMessages(locale).jsonBroken('.palette'))
  }
  return { background: raw.background, shared1: raw.shared1, shared2: raw.shared2 }
}

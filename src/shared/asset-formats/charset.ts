/**
 * The `.petscii` charset format (PETSCII_FORMAT.md §4): 256 chars, each 8 raw C64
 * bytes. The stored bytes are mode-INDEPENDENT — only the interpretation differs
 * (hi-res 8×8 vs MC 4×8 double-pixels). This module owns the on-disk SHAPE; the
 * editor packs/unpacks index grids around it (its graphics mode), the build
 * resolver flattens the rows to one byte array. Per-row length and per-byte range
 * are NOT validated here — that's the caller's policy (editor tolerates, build throws).
 */
import { AssetFormatError } from './error'
import { formatMessages, DEFAULT_FORMAT_LOCALE, type Locale } from './messages'

export const CHARSET_FORMAT = 'breadcraft.petscii'
export const CHAR_COUNT = 256
export const BYTES_PER_CHAR = 8

/** Serialize 256 rows of 8 raw bytes to the `.petscii` JSON. Callers pass already
 *  byte-packed rows (the editor packs its index grid per graphics mode first).
 *
 *  Optional per-slot SOLIDITY (S11): a tile flagged solid blocks the player
 *  (collision is a property of the TILE, not its map position). Stored as a sparse
 *  list of solid slot numbers — and ONLY when at least one slot is solid, so a
 *  charset without any solid tiles stays byte-identical to the old untagged format
 *  (forward/backward compatible). */
export function serializeCharset(chars: number[][], solid?: readonly boolean[]): string {
  const obj: {
    format: string
    version: number
    charCount: number
    chars: number[][]
    solid?: number[]
  } = { format: CHARSET_FORMAT, version: 1, charCount: CHAR_COUNT, chars }
  if (solid) {
    const slots: number[] = []
    for (let i = 0; i < CHAR_COUNT; i++) if (solid[i]) slots.push(i)
    if (slots.length) obj.solid = slots
  }
  return JSON.stringify(obj)
}

/**
 * Read the per-slot solidity flags from a `.petscii` (S11), tolerantly: any slot
 * number in the `solid` list flips that slot true. Returns a fixed 256-entry boolean
 * array (all false when the field is absent — old files / no solid tiles). Never
 * throws: a malformed file just yields all-false (the editor stays usable).
 */
export function parseCharsetSolid(text: string): boolean[] {
  const flags = new Array<boolean>(CHAR_COUNT).fill(false)
  let raw: { solid?: unknown }
  try {
    raw = JSON.parse(text) as { solid?: unknown }
  } catch {
    return flags
  }
  if (!Array.isArray(raw.solid)) return flags
  for (const s of raw.solid) {
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < CHAR_COUNT) flags[s] = true
  }
  return flags
}

/**
 * Structurally parse a `.petscii`: valid JSON, a `chars` array of exactly
 * CHAR_COUNT rows. Returns the raw rows untouched. Throws AssetFormatError on a
 * structural problem (the message is a predicate phrase for the caller to prefix).
 */
export function parseCharset(text: string, locale: Locale = DEFAULT_FORMAT_LOCALE): number[][] {
  const M = formatMessages(locale)
  let raw: { chars?: unknown }
  try {
    raw = JSON.parse(text) as { chars?: unknown }
  } catch {
    throw new AssetFormatError(M.jsonBroken('.petscii'))
  }
  if (!Array.isArray(raw.chars)) {
    throw new AssetFormatError(M.noField('chars'))
  }
  if (raw.chars.length !== CHAR_COUNT) {
    throw new AssetFormatError(M.wrongCharCount(raw.chars.length, CHAR_COUNT))
  }
  return raw.chars as number[][]
}

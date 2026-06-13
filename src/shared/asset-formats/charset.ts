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
 *  byte-packed rows (the editor packs its index grid per graphics mode first). */
export function serializeCharset(chars: number[][]): string {
  return JSON.stringify({ format: CHARSET_FORMAT, version: 1, charCount: CHAR_COUNT, chars })
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

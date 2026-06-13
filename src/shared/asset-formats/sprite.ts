/**
 * The `.sprite` format (one figure = a list of animation FRAMES, each 63 raw C64
 * sprite-shape bytes; PETSCII_FORMAT/sprite). The stored bytes are mode-INDEPENDENT
 * (only interpretation differs). This module owns the on-disk SHAPE and parses it
 * ONCE — frames AND the individual colour from a single JSON.parse (kills the
 * resolver's double-parse, Befund 25). Per-frame length, byte range, and the
 * colour/blank-frame fallbacks are the caller's policy.
 */
import { AssetFormatError } from './error'
import { formatMessages, DEFAULT_FORMAT_LOCALE, type Locale } from './messages'

export const SPRITE_FORMAT = 'breadcraft.sprite'
/** A C64 hardware sprite shape: 24×21 px = 3 bytes/row × 21 = 63 bytes. */
export const SPRITE_BYTES = 63
/** The figure's individual colour default (white, C64 index 1) for files predating it. */
export const DEFAULT_SPRITE_COLOR = 1

/** Frames + colour exactly as found on disk (raw, un-validated). `color` is whatever
 *  the file holds (or undefined for pre-colour files) — clamping is the caller's. */
export interface SpriteRaw {
  frames: number[][]
  color: unknown
}

export function serializeSprite(frames: number[][], color: number): string {
  return JSON.stringify({ format: SPRITE_FORMAT, version: 1, frameCount: frames.length, color, frames })
}

/**
 * Structurally parse a `.sprite`: valid JSON and a `frames` array (an EMPTY array is
 * allowed — the caller decides whether that is an error or a blank frame). Returns
 * the raw frame rows and raw colour. Throws AssetFormatError on a structural problem.
 */
export function parseSprite(text: string, locale: Locale = DEFAULT_FORMAT_LOCALE): SpriteRaw {
  const M = formatMessages(locale)
  let raw: { frames?: unknown; color?: unknown }
  try {
    raw = JSON.parse(text) as { frames?: unknown; color?: unknown }
  } catch {
    throw new AssetFormatError(M.jsonBroken('.sprite'))
  }
  if (!Array.isArray(raw.frames)) {
    throw new AssetFormatError(M.noField('frames'))
  }
  return { frames: raw.frames as number[][], color: raw.color }
}

/**
 * The `.tilemap` format (TILEMAP_EDITOR.md §4): a graphics layer of tile numbers
 * PLUS a parallel per-cell Color-RAM colour. Future-proof shape — `layers` is an
 * ARRAY of layer objects (so later META/parallax layers slot in), and Phase 1 holds
 * one `grafik` layer. This module owns the on-disk SHAPE (incl. the `colors` field
 * both sides used to know differently — Befund 4); value ranges and the per-cell
 * Color-RAM default are the caller's policy.
 *
 * S1.B2.T1: `width`/`height` were always WRITTEN but never READ — every side just
 * assumed 40×25. Now the file's own dimensions are the truth, so a map may be WIDER
 * than one screen (the scrolling world of `UseMap`). A file without the fields is a
 * pre-B2 map and is exactly one screen (SCREEN_W×SCREEN_H) — that is what those
 * files always were.
 */
import { AssetFormatError } from './error'
import {
  formatMessages,
  DEFAULT_FORMAT_LOCALE,
  type FormatMessages,
  type Locale
} from './messages'

export const TILEMAP_FORMAT = 'breadcraft.tilemap'
/** One C64 screen of character cells — the size of a pre-B2 map and the default for
 *  a new one. `MAP_W`/`MAP_H` keep the old names (many call sites) but now mean "one
 *  screen", not "every map". */
export const MAP_W = 40
export const MAP_H = 25
export const MAP_CELLS = MAP_W * MAP_H // 1000
export const SCREEN_W = MAP_W
export const SCREEN_H = MAP_H
/** A map may not be narrower than one screen (the VIC always draws 40 columns) and
 *  the upper bound is only sanity — RAM is what really caps it (~400 bytes per screen
 *  of level, S1.T4), and that gets shown, not forbidden. */
export const MIN_MAP_W = SCREEN_W
export const MAX_MAP_W = 4000
/** The free 4th MC colour a cell starts with (white, C64 index 1) until the user
 *  picks one — the value to fill when a file predates per-cell Color-RAM. Must lie in
 *  0–7: in multicolor-text mode the free %11 colour comes from the low 3 bits of
 *  Color-RAM, so only the first 8 C64 colours can be that colour at all. */
export const DEFAULT_COLOR_RAM = 1

/** The grafik layer's two parallel arrays exactly as found on disk (raw, un-clamped),
 *  plus the map's own dimensions. `colors` is null for files predating per-cell
 *  Color-RAM — forward-compat (filling the default) is the caller's policy. */
export interface TilemapLayerRaw {
  tiles: number[]
  colors: number[] | null
  /** Columns the file declares — one screen for a pre-B2 map without the field. */
  width: number
  /** Rows the file declares. Vertical scrolling is deferred, so this is one screen
   *  today; the field is read anyway so the format never lies about itself. */
  height: number
}

export function serializeTilemap(
  tiles: number[],
  colors: number[],
  width: number = SCREEN_W,
  height: number = SCREEN_H
): string {
  return JSON.stringify({
    format: TILEMAP_FORMAT,
    version: 1,
    width,
    height,
    layers: [{ type: 'grafik', tiles, colors }]
  })
}

/**
 * Structurally parse a `.tilemap`: valid JSON, a `layers` array, a `grafik` layer
 * (or the first layer) carrying a `tiles` array, plus the map's dimensions. Returns
 * the raw grafik `tiles`/`colors` (null when absent) and `width`/`height`. Throws
 * AssetFormatError on a structural problem.
 */
export function parseTilemap(text: string, locale: Locale = DEFAULT_FORMAT_LOCALE): TilemapLayerRaw {
  const M = formatMessages(locale)
  let raw: { layers?: unknown; width?: unknown; height?: unknown }
  try {
    raw = JSON.parse(text) as { layers?: unknown; width?: unknown; height?: unknown }
  } catch {
    throw new AssetFormatError(M.jsonBroken('.tilemap'))
  }
  if (!Array.isArray(raw.layers)) {
    throw new AssetFormatError(M.noField('layers'))
  }
  const layers = raw.layers as { type?: string; tiles?: unknown; colors?: unknown }[]
  const grafik = layers.find((l) => l.type === 'grafik') ?? layers[0]
  if (!grafik || !Array.isArray(grafik.tiles)) {
    throw new AssetFormatError(M.noGrafikLayer())
  }
  return {
    tiles: grafik.tiles as number[],
    colors: Array.isArray(grafik.colors) ? (grafik.colors as number[]) : null,
    width: mapDim(raw.width, SCREEN_W, MIN_MAP_W, MAX_MAP_W, 'width', M),
    height: mapDim(raw.height, SCREEN_H, SCREEN_H, SCREEN_H, 'height', M)
  }
}

/**
 * A declared dimension: absent → `fallback` (a pre-B2 map is one screen), present →
 * must be a whole number inside [min, max], else the file is structurally wrong. A
 * garbled dimension is NOT quietly repaired: sizing a map off a bad number would
 * silently shear the whole level (every row offset by one).
 */
function mapDim(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
  M: FormatMessages
): number {
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new AssetFormatError(M.mapDimBad(field, v, min, max))
  }
  return v
}

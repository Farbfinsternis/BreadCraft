/**
 * The `.tilemap` format (TILEMAP_EDITOR.md §4): a 40×25 graphics layer of tile
 * numbers PLUS a parallel per-cell Color-RAM colour. Future-proof shape — `layers`
 * is an ARRAY of layer objects (so later META/parallax layers slot in), and Phase 1
 * holds one `grafik` layer. This module owns the on-disk SHAPE (incl. the `colors`
 * field both sides used to know differently — Befund 4); value ranges and the
 * per-cell Color-RAM default are the caller's policy.
 */
import { AssetFormatError } from './error'
import { formatMessages, DEFAULT_FORMAT_LOCALE, type Locale } from './messages'

export const TILEMAP_FORMAT = 'breadcraft.tilemap'
export const MAP_W = 40
export const MAP_H = 25
export const MAP_CELLS = MAP_W * MAP_H // 1000
/** The free 4th MC colour a cell starts with (white, C64 index 1) until the user
 *  picks one — the value to fill when a file predates per-cell Color-RAM. Must lie in
 *  0–7: in multicolor-text mode the free %11 colour comes from the low 3 bits of
 *  Color-RAM, so only the first 8 C64 colours can be that colour at all. */
export const DEFAULT_COLOR_RAM = 1

/** The grafik layer's two parallel arrays exactly as found on disk (raw, un-clamped).
 *  `colors` is null for files predating per-cell Color-RAM — forward-compat (filling
 *  the default) is the caller's policy. */
export interface TilemapLayerRaw {
  tiles: number[]
  colors: number[] | null
}

export function serializeTilemap(tiles: number[], colors: number[]): string {
  return JSON.stringify({
    format: TILEMAP_FORMAT,
    version: 1,
    width: MAP_W,
    height: MAP_H,
    layers: [{ type: 'grafik', tiles, colors }]
  })
}

/**
 * Structurally parse a `.tilemap`: valid JSON, a `layers` array, a `grafik` layer
 * (or the first layer) carrying a `tiles` array. Returns the raw grafik `tiles` and
 * `colors` (null when absent). Throws AssetFormatError on a structural problem.
 */
export function parseTilemap(text: string, locale: Locale = DEFAULT_FORMAT_LOCALE): TilemapLayerRaw {
  const M = formatMessages(locale)
  let raw: { layers?: unknown }
  try {
    raw = JSON.parse(text) as { layers?: unknown }
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
    colors: Array.isArray(grafik.colors) ? (grafik.colors as number[]) : null
  }
}

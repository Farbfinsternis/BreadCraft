/**
 * Asset serialization + project-bound disk IO for the renderer (ASSET_IO.md §3/§4).
 * The main process does the raw file write/read + .bread manifest; here we turn
 * editor state into the on-disk FORMAT and back. One small module both asset
 * stores (palette, charset) lean on — closes memory breadcraft-asset-io-debt.
 *
 * The on-disk SHAPE itself lives once in `@shared/asset-formats` (Befund 23); this
 * module is the renderer's TOLERANT layer on top: it packs/unpacks index grids per
 * graphics mode and turns any format error into a quiet null / clamped value (the
 * editor loads what it can rather than crashing). The build resolver shares the same
 * codecs with the opposite, strict policy.
 */
import {
  indicesToBytesHires,
  bytesToIndicesHires,
  indicesToBytesMC,
  bytesToIndicesMC
} from '@renderer/pixel-engine/charsetBytes'
import {
  indicesToBytesSpriteHires,
  bytesToIndicesSpriteHires,
  indicesToBytesSpriteMC,
  bytesToIndicesSpriteMC,
  pixelsPerSprite
} from '@renderer/pixel-engine/spriteBytes'
import type { GraphicsMode } from '@shared/ipc'
import * as fmt from '@shared/asset-formats'

/** Default file names for the single-per-project assets. */
export const PALETTE_FILE = 'project.palette'
export const CHARSET_FILE = 'main.petscii'
export const TILEMAP_FILE = 'main.tilemap'
export const SPRITE_FILE = 'main.sprite'

const CHAR_COUNT = fmt.CHAR_COUNT

/** A char's index-grid size depends on the mode: hi-res 8×8 = 64, MC 4×8 = 32
 *  double-pixels (the converters' shapes, PETSCII_FORMAT.md §1.1). One truth the
 *  charset store + serializer share so save/load round-trips at the right size. */
export function pixelsPerChar(mode: GraphicsMode): number {
  return mode === 'TEXT_MULTICOLOR' ? 32 : 64
}

/** Pick the index↔bytes converter pair for a graphics mode (the MC-vs-hi-res seam). */
function charsetCodec(mode: GraphicsMode): {
  pack: (cells: Uint8Array | number[]) => Uint8Array
  unpack: (bytes: Uint8Array | number[]) => Uint8Array
} {
  return mode === 'TEXT_MULTICOLOR'
    ? { pack: indicesToBytesMC, unpack: bytesToIndicesMC }
    : { pack: indicesToBytesHires, unpack: bytesToIndicesHires }
}

/** Standard C64 screen — one tilemap cell per character cell. */
export const MAP_W = fmt.MAP_W
export const MAP_H = fmt.MAP_H
const MAP_CELLS = fmt.MAP_CELLS // 1000

// ---- Palette (.palette) ----

export interface PaletteData {
  background: number
  shared1: number
  shared2: number
}

/** Serialize the project palette to the `.palette` JSON (PALETTE_FORMAT.md). */
export function serializePalette(p: PaletteData): string {
  return fmt.serializePalette(p)
}

/** Parse a `.palette` file; returns null if malformed. Each field clamps to its
 *  readable default on a bad/out-of-range value (the editor's tolerant policy). */
export function parsePalette(text: string): PaletteData | null {
  let raw: fmt.PaletteRaw
  try {
    raw = fmt.parsePalette(text)
  } catch {
    return null
  }
  const clamp = (n: unknown, d: number): number =>
    typeof n === 'number' && n >= 0 && n <= 15 ? n : d
  return {
    background: clamp(raw.background, 0),
    shared1: clamp(raw.shared1, 9),
    shared2: clamp(raw.shared2, 14)
  }
}

// ---- Charset (.petscii) ----

/**
 * Serialize the 256-char index grid to the `.petscii` JSON: 256 dense slots, 8
 * raw C64 bytes each (PETSCII_FORMAT.md §4). The packing follows the project's
 * `graphicsMode` — MC packs 2-bit pairs (indices 0–3 survive), hi-res packs 1 bit
 * (PETSCII_FORMAT.md §1.1). `chars` is sparse (only edited indices present);
 * missing chars write as empty (8 zero bytes). The stored BYTES are mode-
 * independent (§1; only the interpretation differs) — so no mode lives in the file.
 */
export function serializeCharset(chars: Record<number, Uint8Array>, mode: GraphicsMode): string {
  const { pack } = charsetCodec(mode)
  const out: number[][] = []
  for (let i = 0; i < CHAR_COUNT; i++) {
    const cells = chars[i]
    out.push(Array.from(cells ? pack(cells) : new Uint8Array(8)))
  }
  return fmt.serializeCharset(out)
}

/**
 * Parse a `.petscii` file into the sparse index-grid map the store holds, reading
 * the 8 raw bytes per char as `graphicsMode` dictates (MC → 32 double-pixels,
 * hi-res → 64 pixels). Only non-empty chars are kept (matches the store's sparse
 * model). Returns null if malformed.
 */
export function parseCharset(
  text: string,
  mode: GraphicsMode
): Record<number, Uint8Array> | null {
  let rows: number[][]
  try {
    rows = fmt.parseCharset(text)
  } catch {
    return null
  }
  const { unpack } = charsetCodec(mode)
  const expected = pixelsPerChar(mode)
  const result: Record<number, Uint8Array> = {}
  for (let i = 0; i < rows.length && i < CHAR_COUNT; i++) {
    const bytes = rows[i]
    if (!Array.isArray(bytes) || bytes.length !== 8) continue
    if (bytes.every((b) => b === 0)) continue // empty slot → stay sparse
    const cells = unpack(Uint8Array.from(bytes))
    if (cells.length === expected) result[i] = cells
  }
  return result
}

// ---- Tilemap (.tilemap) ----

/** Default Color-RAM colour for cells (white, C64 index 1) — the free 4th MC colour
 *  a cell starts with until the user picks one. Lives in 0–7 (the only colours the
 *  C64 can show as the free %11 colour in multicolor-text mode). */
export const DEFAULT_COLOR_RAM = fmt.DEFAULT_COLOR_RAM

/** The graphics layer's two parallel per-cell arrays: tile numbers (0–255) and
 *  Color-RAM colours (C64 index 0–15, the free MC colour per 8×8 cell). */
export interface TilemapData {
  tiles: Uint8Array
  colors: Uint8Array
}

/**
 * Serialize the 40×25 graphics layer to the `.tilemap` JSON (TILEMAP_EDITOR.md §4).
 *
 * Future-proof shape: layers are an ARRAY of layer objects, NOT hardcoded fields —
 * so later layers (META data layer, parallax) slot in without a format rewrite.
 * Phase 1 holds one `grafik` layer of 1000 tile numbers (0–255) PLUS its 1000
 * Color-RAM colours (0–15, the free MC colour per cell, §4 "+ zugehöriges Color-RAM").
 */
export function serializeTilemap(data: TilemapData): string {
  return fmt.serializeTilemap(Array.from(data.tiles), Array.from(data.colors))
}

/**
 * Parse a `.tilemap` file into the dense 1000-cell graphics layer (tiles + Color-
 * RAM). Reads the first `grafik` layer (Phase 1 has exactly one). Color-RAM is
 * forward-compatible: files predating it (no `colors`) default every cell to
 * DEFAULT_COLOR_RAM. Returns null if malformed (wrong format, missing/short tiles)
 * so the editor starts empty rather than loading garbage. Out-of-range tile/colour
 * values clamp to 0 / DEFAULT_COLOR_RAM (the editor's tolerant policy).
 */
export function parseTilemap(text: string): TilemapData | null {
  let raw: fmt.TilemapLayerRaw
  try {
    raw = fmt.parseTilemap(text)
  } catch {
    return null
  }

  const tiles = new Uint8Array(MAP_CELLS)
  for (let i = 0; i < MAP_CELLS && i < raw.tiles.length; i++) {
    const n = raw.tiles[i]
    tiles[i] = typeof n === 'number' && n >= 0 && n <= 255 ? n : 0
  }

  const colors = new Uint8Array(MAP_CELLS).fill(DEFAULT_COLOR_RAM)
  if (raw.colors) {
    for (let i = 0; i < MAP_CELLS && i < raw.colors.length; i++) {
      const c = raw.colors[i]
      if (typeof c === 'number' && c >= 0 && c <= 15) colors[i] = c
    }
  }
  return { tiles, colors }
}

// ---- Sprite (.sprite) ----

/** Pick the index↔bytes converter pair for a sprite (the MC-vs-hi-res seam). */
function spriteCodec(mode: GraphicsMode): {
  pack: (cells: Uint8Array | number[]) => Uint8Array
  unpack: (bytes: Uint8Array | number[]) => Uint8Array
} {
  return mode === 'TEXT_MULTICOLOR'
    ? { pack: indicesToBytesSpriteMC, unpack: bytesToIndicesSpriteMC }
    : { pack: indicesToBytesSpriteHires, unpack: bytesToIndicesSpriteHires }
}

/**
 * One sprite ASSET = one figure (player, blob, …) as a list of animation FRAMES.
 * Each frame is an index grid (24×21 hi-res = 504 cells, 12×21 MC = 252). ITD uses
 * only frame 0 for now; the array shape lets later animation add frames without a
 * format rewrite (the user's P2.T1 sharpening: one sprite/file, but animatable).
 */
export interface SpriteData {
  frames: Uint8Array[]
  /** The figure's INDIVIDUAL multicolor (spr_color[n], the "10" pixel pair) as a
   *  C64 index 0–15. The two SHARED colours come from the project palette; this one
   *  is per-sprite (so player and blob can differ). Default white (1). */
  color: number
}

/** Default individual sprite colour (white, C64 index 1) — the "10" pair until the
 *  user picks one in the sprite editor. */
export const DEFAULT_SPRITE_COLOR = fmt.DEFAULT_SPRITE_COLOR

/**
 * Serialize a sprite to the `.sprite` JSON: a `frames` array, each frame 63 raw
 * C64 sprite-shape bytes. The packing follows the project's `graphicsMode` (MC
 * packs 2-bit pairs, indices 0–3 survive; hi-res packs 1 bit) — same bit order as
 * `.petscii`. The stored BYTES are mode-independent (only interpretation differs),
 * so no mode lives in the file. An empty figure still writes one all-zero frame.
 */
export function serializeSprite(sprite: SpriteData, mode: GraphicsMode): string {
  const { pack } = spriteCodec(mode)
  const frames = sprite.frames.length ? sprite.frames : [new Uint8Array(pixelsPerSprite(mode))]
  const out = frames.map((cells) => Array.from(pack(cells)))
  return fmt.serializeSprite(out, clampColorIndex(sprite.color))
}

/** Clamp any value to a valid C64 colour index 0–15 (default white on garbage). */
function clampColorIndex(n: unknown): number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 15 ? n : DEFAULT_SPRITE_COLOR
}

/**
 * Parse a `.sprite` file into the frame index-grids the store holds, reading the
 * 63 raw bytes per frame as `graphicsMode` dictates (MC → 252 double-pixels, hi-res
 * → 504 pixels). Always returns at least one frame (a blank one) so the editor has
 * something to draw on. Returns null if malformed (wrong format / no frames).
 */
export function parseSprite(text: string, mode: GraphicsMode): SpriteData | null {
  let raw: fmt.SpriteRaw
  try {
    raw = fmt.parseSprite(text)
  } catch {
    return null
  }
  const { unpack } = spriteCodec(mode)
  const expected = pixelsPerSprite(mode)
  const frames: Uint8Array[] = []
  for (const bytes of raw.frames) {
    if (!Array.isArray(bytes) || bytes.length !== fmt.SPRITE_BYTES) continue
    const cells = unpack(Uint8Array.from(bytes))
    if (cells.length === expected) frames.push(cells)
  }
  if (frames.length === 0) frames.push(new Uint8Array(expected))
  // `color` is optional — old files (pre-individual-colour) default to white.
  return { frames, color: clampColorIndex(raw.color) }
}

/**
 * The `.bread` asset bridge (Transpiler-Roadmap §2.5, Stufe 2 Teil B foundation).
 *
 * Tile/sprite commands name their assets by STRING id — `UseTileset "main"`. To
 * emit C, the code generator must turn that id into the actual C64 bytes the
 * editor painted (the `.petscii` is already C64 truth: 256 slots × 8 raw bytes).
 * This module is that translation, and ONLY that: id string → resolved bytes +
 * metadata. No graphics command is emitted here — that's the next layer.
 *
 * Deliberately pure and IO-free: the caller injects how to read a file's text
 * (`readFile`), so this resolver is unit-testable without a filesystem and never
 * imports `fs` or any renderer code (keeps the repo-structure guard intact). In
 * production the build service hands it the real `readAsset`.
 *
 * Strict & eager (the chosen contract): resolving validates immediately — missing
 * asset, unreadable file, wrong format, bad byte shape all surface NOW, at the
 * resolving command's position, long before cc65 runs. An honest cost-safety net,
 * never a silent fallback.
 *
 * The on-disk SHAPE itself lives once in `@shared/asset-formats` (Befund 23); this
 * resolver is the STRICT layer on top — it lets a structural AssetFormatError surface
 * as an AssetResolveError (file path + position), then validates element ranges
 * itself. The renderer asset store shares the same codecs with the opposite,
 * tolerant policy.
 */
import * as fmt from '@shared/asset-formats'
import { messages, DEFAULT_LOCALE, type ResolverMessages } from '../messages'
import type { Locale } from '@shared/ipc'

/** The manifest slice the resolver needs (mirror of shared `BreadAssets`). */
export interface AssetManifest {
  /** The project's single `.palette` file, or null if none has been saved yet. */
  palette: string | null
  charsets: string[]
  tilemaps: string[]
  sprites: string[]
}

/** Reads an asset file's text content by its manifest-relative path; null if
 *  the file is absent. (Injected — the resolver itself touches no filesystem.) */
export type AssetReader = (rel: string) => string | null

/** A successfully resolved tileset/charset: the raw C64 charset bytes, ready to
 *  be baked into the generated C by a later layer. */
export interface ResolvedCharset {
  kind: 'charset'
  /** The id as written in the source (`"main"`). */
  id: string
  /** The manifest-relative file it resolved to (`main.petscii`). */
  rel: string
  /** 256 chars × 8 bytes, row-major and flat (char i = bytes [i*8 .. i*8+7]).
   *  Mode-independent C64 truth, exactly as the `.petscii` stores it. */
  bytes: Uint8Array
  /** Number of chars (always CHAR_COUNT for a charset; explicit for clarity). */
  charCount: number
  /** Per-slot SOLIDITY (STAHL S11): solid[i] === true → tile i blocks the player.
   *  Read TOLERANTLY (an old/untagged `.petscii` yields all-false — nothing solid by
   *  default; the user paints walls in the editor). The codegen bakes this into a
   *  `bc_solid[256]` table so TileSolid is a property of the TILE, not its map cell. */
  solid: boolean[]
}

/** Raised when an asset can't be resolved. Carries a plain message; the caller
 *  attaches source position + severity when turning it into a CodeGenError. */
export class AssetResolveError extends Error {}

/** Run a shared structural codec; rephrase its AssetFormatError as an
 *  AssetResolveError carrying the asset label + path (the strict-layer policy). The
 *  shared message is a predicate phrase, so this reads as one sentence:
 *  `Tileset 'main.petscii' ist kein gültiges .petscii (JSON kaputt)`. */
function withFormatError<T>(label: string, rel: string, run: () => T): T {
  try {
    return run()
  } catch (e) {
    if (e instanceof fmt.AssetFormatError) {
      throw new AssetResolveError(`${label} '${rel}' ${e.message}`)
    }
    throw e
  }
}

// Format dimensions/constants come from the shared codecs (one place — Befund 21/23).
const CHAR_COUNT = fmt.CHAR_COUNT
const BYTES_PER_CHAR = fmt.BYTES_PER_CHAR
const MAP_W = fmt.MAP_W
const MAP_H = fmt.MAP_H
const MAP_CELLS = fmt.MAP_CELLS
const SPRITE_BYTES = fmt.SPRITE_BYTES

/** A successfully resolved tilemap: 1000 tile numbers PLUS the parallel per-cell
 *  Color-RAM colours, ready to bake into C. */
export interface ResolvedTilemap {
  kind: 'tilemap'
  id: string
  rel: string
  /** 1000 tile numbers (0–255), row-major (cell = row*40 + col). */
  tiles: Uint8Array
  /** 1000 per-cell Color-RAM colours (0–15), row-major — the free 4th MC colour the
   *  editor painted per 8×8 cell. Parallel to `tiles`; cells past the stored data (or
   *  files predating per-cell colour) carry DEFAULT_COLOR_RAM. */
  colors: Uint8Array
  width: number
  height: number
}

/** A manifest path without its file extension, forward-slashed:
 *  `assets/sprites/player.sprite` → `assets/sprites/player`. This is the canonical
 *  asset id authors write in source (P2.T0b: the full project-relative path, so two
 *  files of the same basename in different folders never collide). */
function relWithoutExt(rel: string): string {
  const norm = rel.replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  const dot = norm.lastIndexOf('.')
  return dot > slash ? norm.slice(0, dot) : norm
}

/**
 * Does manifest path `rel` match the source id `id`? The id is the project-relative
 * path without extension (`assets/sprites/player`). For a file flat in the project
 * root this is just its basename (`main.sprite` → `main`), so the short form still
 * works for root-level assets; sub-folder assets need the full path. The id may also
 * be written WITH the extension — both forms match. Comparison is forward-slashed.
 */
function relMatches(rel: string, id: string): boolean {
  const want = id.replace(/\\/g, '/')
  return relWithoutExt(rel) === want || rel.replace(/\\/g, '/') === want
}

/** The author-facing id of a manifest path (for "Projekt kennt: …" hints). */
function idOf(rel: string): string {
  return relWithoutExt(rel)
}

/**
 * Resolve a tileset/charset id (`"main"`) to its raw C64 bytes.
 *
 * Matches the id against the manifest's charsets by filename stem, reads the
 * `.petscii`, and validates its shape. Throws AssetResolveError (with an honest,
 * author-facing message) on any problem — unknown id, missing/garbled file, or
 * malformed byte layout.
 */
export function resolveCharset(
  id: string,
  manifest: AssetManifest,
  readFile: AssetReader,
  locale: Locale = DEFAULT_LOCALE
): ResolvedCharset {
  const M = messages(locale).resolver
  const rel = manifest.charsets.find((c) => relMatches(c, id))
  if (!rel) {
    const known = manifest.charsets.map(idOf)
    const hint = known.length ? known.join(', ') : M.noneKnown
    throw new AssetResolveError(M.unknownTileset(id, hint))
  }

  const text = readFile(rel)
  if (text === null) {
    throw new AssetResolveError(M.tilesetFileMissing(rel))
  }

  return {
    kind: 'charset',
    id,
    rel,
    bytes: parsePetsciiBytes(rel, text, locale),
    charCount: CHAR_COUNT,
    // Solidity is read tolerantly (the codec never throws): a malformed/old file just
    // means "nothing solid". The strict byte validation above still guards the shape.
    solid: fmt.parseCharsetSolid(text)
  }
}

/**
 * Parse the `.petscii` JSON into a flat 256×8 byte array. The on-disk shape is
 * `{ chars: number[][] }` (256 rows of 8 bytes) — the editor's serializeCharset
 * truth. Any deviation is a hard error (strict bridge), not a guess.
 */
function parsePetsciiBytes(rel: string, text: string, locale: Locale): Uint8Array {
  const M = messages(locale).resolver
  const rows = withFormatError(M.labelTileset, rel, () => fmt.parseCharset(text, locale))

  const bytes = new Uint8Array(CHAR_COUNT * BYTES_PER_CHAR)
  for (let i = 0; i < CHAR_COUNT; i++) {
    const row = rows[i]
    if (!Array.isArray(row) || row.length !== BYTES_PER_CHAR) {
      throw new AssetResolveError(M.charByteCountWrong(rel, i, BYTES_PER_CHAR))
    }
    for (let j = 0; j < BYTES_PER_CHAR; j++) {
      const b = row[j]
      if (typeof b !== 'number' || b < 0 || b > 255 || !Number.isInteger(b)) {
        throw new AssetResolveError(M.charByteBad(rel, i, j))
      }
      bytes[i * BYTES_PER_CHAR + j] = b
    }
  }
  return bytes
}

/**
 * Resolve a tilemap id (`"level1"`) to its 1000 tile numbers. Same strict, eager
 * contract as resolveCharset: unknown id / missing file / wrong format all throw
 * AssetResolveError at resolve time. Reads the `.tilemap`'s first `grafik` layer
 * (Phase 1 has exactly one) — the editor's serializeTilemap truth.
 */
export function resolveTilemap(
  id: string,
  manifest: AssetManifest,
  readFile: AssetReader,
  locale: Locale = DEFAULT_LOCALE
): ResolvedTilemap {
  const M = messages(locale).resolver
  const rel = manifest.tilemaps.find((m) => relMatches(m, id))
  if (!rel) {
    const known = manifest.tilemaps.map(idOf)
    const hint = known.length ? known.join(', ') : M.noneKnown
    throw new AssetResolveError(M.unknownMap(id, hint))
  }

  const text = readFile(rel)
  if (text === null) {
    throw new AssetResolveError(M.mapFileMissing(rel))
  }

  const { tiles, colors } = parseTilemapData(rel, text, locale)
  return { kind: 'tilemap', id, rel, tiles, colors, width: MAP_W, height: MAP_H }
}

/**
 * Parse the `.tilemap` JSON into parallel flat 1000-element tile + Color-RAM arrays.
 * Shape is `{ layers: [{ type, tiles: number[], colors: number[] | null }] }`; reads
 * the `grafik` layer. Strict: malformed structure or an out-of-range value is a hard
 * error (the bake must not poke garbage into Screen/Color RAM). A short `tiles` layer
 * is padded with 0 (empty tile); a short/absent `colors` is padded with the default
 * per-cell colour — both are valid partial / pre-colour maps.
 */
function parseTilemapData(
  rel: string,
  text: string,
  locale: Locale
): { tiles: Uint8Array; colors: Uint8Array } {
  const M = messages(locale).resolver
  const { tiles: srcTiles, colors: srcColors } = withFormatError(M.labelMap, rel, () =>
    fmt.parseTilemap(text, locale)
  )

  const tiles = new Uint8Array(MAP_CELLS)
  for (let i = 0; i < MAP_CELLS && i < srcTiles.length; i++) {
    const n = srcTiles[i]
    if (typeof n !== 'number' || n < 0 || n > 255 || !Number.isInteger(n)) {
      throw new AssetResolveError(M.tileNumberBad(rel, i))
    }
    tiles[i] = n
  }

  const colors = new Uint8Array(MAP_CELLS).fill(fmt.DEFAULT_COLOR_RAM)
  if (srcColors) {
    for (let i = 0; i < MAP_CELLS && i < srcColors.length; i++) {
      const c = srcColors[i]
      if (typeof c !== 'number' || c < 0 || c > 15 || !Number.isInteger(c)) {
        throw new AssetResolveError(M.colorRamBad(rel, i))
      }
      colors[i] = c
    }
  }
  return { tiles, colors }
}

/** A successfully resolved palette: the three SHARED C64 colour registers as
 *  indices 0–15 (background = bgcolor0; shared1/2 = bgcolor1/2 = spr_mcolor0/1).
 *  These are the colours UseTileset + UseSprite poke into the VIC so the running
 *  program matches what the editor painted (memory breadcraft-project-palette). */
export interface ResolvedPalette {
  kind: 'palette'
  background: number
  shared1: number
  shared2: number
}

/** The project palette's default trio when no `.palette` exists yet — the same
 *  readable defaults the editor's palette store starts with (palette.ts), so an
 *  un-configured project still builds with sensible (if not chosen) colours. */
export const DEFAULT_PALETTE: ResolvedPalette = {
  kind: 'palette',
  background: 0, // black
  shared1: 9, // brown
  shared2: 14 // light blue
}

/**
 * Resolve the project's palette to its three shared colour indices. Unlike the
 * other resolvers this NEVER throws on "absent": a project with no `.palette` is
 * legitimate (the user just hasn't set colours), so we fall back to DEFAULT_PALETTE.
 * A PRESENT but garbled file is still a hard error (strict bridge) — a broken file
 * the user did create should surface, not silently revert.
 */
export function resolvePalette(
  manifest: AssetManifest,
  readFile: AssetReader,
  locale: Locale = DEFAULT_LOCALE
): ResolvedPalette {
  if (!manifest.palette) return DEFAULT_PALETTE
  const text = readFile(manifest.palette)
  if (text === null) return DEFAULT_PALETTE // referenced but missing → defaults, not a crash
  return parsePaletteIndices(manifest.palette, text, locale)
}

/** Parse a `.palette` JSON into the three shared indices. Shape is
 *  `{ background, shared1, shared2 }` (each 0–15) — the editor's serializePalette
 *  truth. Out-of-range or non-integer values are a hard error. */
function parsePaletteIndices(rel: string, text: string, locale: Locale): ResolvedPalette {
  const M = messages(locale).resolver
  const raw = withFormatError(M.labelPalette, rel, () => fmt.parsePalette(text, locale))
  const idx = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 15) {
      throw new AssetResolveError(M.paletteIndexBad(rel, name))
    }
    return v
  }
  return {
    kind: 'palette',
    background: idx(raw.background, 'background'),
    shared1: idx(raw.shared1, 'shared1'),
    shared2: idx(raw.shared2, 'shared2')
  }
}

/** A successfully resolved sprite: one figure's animation frames, each 63 raw
 *  C64 sprite-shape bytes. `UseSprite` (P2.T3) bakes frame 0; later animation
 *  uses the rest. One sprite asset = one figure (the P2.T1 decision). */
export interface ResolvedSprite {
  kind: 'sprite'
  id: string
  rel: string
  /** One Uint8Array per frame, each exactly 63 bytes (row-major, byte[0] top-left).
   *  Mode-independent C64 truth, exactly as the `.sprite` stores it. */
  frames: Uint8Array[]
  /** The figure's INDIVIDUAL colour (spr_color[n]) as a C64 index 0–15. Per-sprite
   *  (player ≠ blob); the shared pair comes from the palette. Default white (1). */
  color: number
}

/** Default individual sprite colour (white, index 1) for pre-colour `.sprite` files. */
const DEFAULT_SPRITE_COLOR = fmt.DEFAULT_SPRITE_COLOR

/**
 * Resolve a sprite id (`"player"`) to its animation frames' raw C64 bytes. Same
 * strict, eager contract as resolveCharset/resolveTilemap: unknown id / missing
 * file / wrong format all throw AssetResolveError at resolve time. Reads the
 * `.sprite`'s `frames` array — the editor's serializeSprite truth.
 */
export function resolveSprite(
  id: string,
  manifest: AssetManifest,
  readFile: AssetReader,
  locale: Locale = DEFAULT_LOCALE
): ResolvedSprite {
  const M = messages(locale).resolver
  const rel = manifest.sprites.find((s) => relMatches(s, id))
  if (!rel) {
    const known = manifest.sprites.map(idOf)
    const hint = known.length ? known.join(', ') : M.noneKnown
    throw new AssetResolveError(M.unknownSprite(id, hint))
  }

  const text = readFile(rel)
  if (text === null) {
    throw new AssetResolveError(M.spriteFileMissing(rel))
  }

  const { frames, color } = parseSpriteData(rel, text, locale)
  return { kind: 'sprite', id, rel, frames, color }
}

/**
 * Parse the `.sprite` JSON into one byte array per frame PLUS the individual colour,
 * from ONE structural parse (the shared codec — no double JSON.parse, Befund 25).
 * Shape is `{ frames: number[][], color? }` — each frame 63 bytes (the editor's
 * serializeSprite truth). Strict: a missing/empty `frames`, a wrong-length frame, or
 * a bad byte value is a hard error (the bake must not poke a garbled shape into
 * sprite RAM). The colour defaults to white if absent (old files) or out of range.
 */
function parseSpriteData(
  rel: string,
  text: string,
  locale: Locale
): { frames: Uint8Array[]; color: number } {
  const M = messages(locale).resolver
  const raw = withFormatError(M.labelSprite, rel, () => fmt.parseSprite(text, locale))
  if (raw.frames.length === 0) {
    throw new AssetResolveError(M.spriteNoFrames(rel))
  }

  const frames: Uint8Array[] = []
  for (let f = 0; f < raw.frames.length; f++) {
    const frame = raw.frames[f]
    if (!Array.isArray(frame) || frame.length !== SPRITE_BYTES) {
      throw new AssetResolveError(M.spriteFrameLenWrong(rel, f, SPRITE_BYTES))
    }
    const bytes = new Uint8Array(SPRITE_BYTES)
    for (let j = 0; j < SPRITE_BYTES; j++) {
      const b = frame[j]
      if (typeof b !== 'number' || b < 0 || b > 255 || !Number.isInteger(b)) {
        throw new AssetResolveError(M.spriteByteBad(rel, f, j))
      }
      bytes[j] = b
    }
    frames.push(bytes)
  }

  const c = raw.color
  const color =
    typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 15 ? c : DEFAULT_SPRITE_COLOR
  return { frames, color }
}

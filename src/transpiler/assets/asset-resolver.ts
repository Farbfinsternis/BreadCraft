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
 */

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
}

/** Raised when an asset can't be resolved. Carries a plain message; the caller
 *  attaches source position + severity when turning it into a CodeGenError. */
export class AssetResolveError extends Error {}

const CHAR_COUNT = 256
const BYTES_PER_CHAR = 8

/** C64 screen tilemap: 40×25 = 1000 cells. */
const MAP_W = 40
const MAP_H = 25
const MAP_CELLS = MAP_W * MAP_H

/** A C64 hardware sprite shape: 24×21 pixels = 3 bytes/row × 21 = 63 bytes. */
const SPRITE_BYTES = 63

/** A successfully resolved tilemap: 1000 tile numbers, ready to bake into C. */
export interface ResolvedTilemap {
  kind: 'tilemap'
  id: string
  rel: string
  /** 1000 tile numbers (0–255), row-major (cell = row*40 + col). */
  tiles: Uint8Array
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
  readFile: AssetReader
): ResolvedCharset {
  const rel = manifest.charsets.find((c) => relMatches(c, id))
  if (!rel) {
    const known = manifest.charsets.map(idOf)
    const hint = known.length ? known.join(', ') : '(keine)'
    throw new AssetResolveError(`unbekanntes Tileset '${id}' — Projekt kennt: ${hint}`)
  }

  const text = readFile(rel)
  if (text === null) {
    throw new AssetResolveError(`Tileset-Datei fehlt: ${rel}`)
  }

  return { kind: 'charset', id, rel, bytes: parsePetsciiBytes(rel, text), charCount: CHAR_COUNT }
}

/**
 * Parse the `.petscii` JSON into a flat 256×8 byte array. The on-disk shape is
 * `{ chars: number[][] }` (256 rows of 8 bytes) — the editor's serializeCharset
 * truth. Any deviation is a hard error (strict bridge), not a guess.
 */
function parsePetsciiBytes(rel: string, text: string): Uint8Array {
  let raw: { chars?: unknown }
  try {
    raw = JSON.parse(text) as { chars?: unknown }
  } catch {
    throw new AssetResolveError(`Tileset '${rel}' ist kein gültiges .petscii (JSON kaputt)`)
  }
  if (!Array.isArray(raw.chars)) {
    throw new AssetResolveError(`Tileset '${rel}' hat keine 'chars'-Daten`)
  }
  if (raw.chars.length !== CHAR_COUNT) {
    throw new AssetResolveError(
      `Tileset '${rel}' hat ${raw.chars.length} Zeichen, erwartet ${CHAR_COUNT}`
    )
  }

  const bytes = new Uint8Array(CHAR_COUNT * BYTES_PER_CHAR)
  for (let i = 0; i < CHAR_COUNT; i++) {
    const row = raw.chars[i]
    if (!Array.isArray(row) || row.length !== BYTES_PER_CHAR) {
      throw new AssetResolveError(
        `Tileset '${rel}', Zeichen ${i}: erwartet ${BYTES_PER_CHAR} Bytes`
      )
    }
    for (let j = 0; j < BYTES_PER_CHAR; j++) {
      const b = row[j]
      if (typeof b !== 'number' || b < 0 || b > 255 || !Number.isInteger(b)) {
        throw new AssetResolveError(
          `Tileset '${rel}', Zeichen ${i}, Byte ${j}: kein gültiger Bytewert (0–255)`
        )
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
  readFile: AssetReader
): ResolvedTilemap {
  const rel = manifest.tilemaps.find((m) => relMatches(m, id))
  if (!rel) {
    const known = manifest.tilemaps.map(idOf)
    const hint = known.length ? known.join(', ') : '(keine)'
    throw new AssetResolveError(`unbekannte Karte '${id}' — Projekt kennt: ${hint}`)
  }

  const text = readFile(rel)
  if (text === null) {
    throw new AssetResolveError(`Karten-Datei fehlt: ${rel}`)
  }

  return { kind: 'tilemap', id, rel, tiles: parseTilemapTiles(rel, text), width: MAP_W, height: MAP_H }
}

/**
 * Parse the `.tilemap` JSON into a flat 1000-tile array. Shape is
 * `{ layers: [{ type, tiles: number[] }] }`; reads the `grafik` layer. Strict:
 * malformed structure is a hard error (the bake must not poke garbage into the
 * screen). A short layer is padded with 0 (empty tile) — that's a valid partial map.
 */
function parseTilemapTiles(rel: string, text: string): Uint8Array {
  let raw: { layers?: unknown }
  try {
    raw = JSON.parse(text) as { layers?: unknown }
  } catch {
    throw new AssetResolveError(`Karte '${rel}' ist kein gültiges .tilemap (JSON kaputt)`)
  }
  if (!Array.isArray(raw.layers)) {
    throw new AssetResolveError(`Karte '${rel}' hat keine 'layers'-Daten`)
  }
  const layers = raw.layers as { type?: string; tiles?: unknown }[]
  const grafik = layers.find((l) => l.type === 'grafik') ?? layers[0]
  if (!grafik || !Array.isArray(grafik.tiles)) {
    throw new AssetResolveError(`Karte '${rel}' hat keinen Grafik-Layer mit Kacheln`)
  }

  const src = grafik.tiles as unknown[]
  const tiles = new Uint8Array(MAP_CELLS)
  for (let i = 0; i < MAP_CELLS && i < src.length; i++) {
    const n = src[i]
    if (typeof n !== 'number' || n < 0 || n > 255 || !Number.isInteger(n)) {
      throw new AssetResolveError(`Karte '${rel}', Zelle ${i}: keine gültige Kachel-Nummer (0–255)`)
    }
    tiles[i] = n
  }
  return tiles
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
export function resolvePalette(manifest: AssetManifest, readFile: AssetReader): ResolvedPalette {
  if (!manifest.palette) return DEFAULT_PALETTE
  const text = readFile(manifest.palette)
  if (text === null) return DEFAULT_PALETTE // referenced but missing → defaults, not a crash
  return parsePaletteIndices(manifest.palette, text)
}

/** Parse a `.palette` JSON into the three shared indices. Shape is
 *  `{ background, shared1, shared2 }` (each 0–15) — the editor's serializePalette
 *  truth. Out-of-range or non-integer values are a hard error. */
function parsePaletteIndices(rel: string, text: string): ResolvedPalette {
  let raw: { background?: unknown; shared1?: unknown; shared2?: unknown }
  try {
    raw = JSON.parse(text)
  } catch {
    throw new AssetResolveError(`Palette '${rel}' ist kein gültiges .palette (JSON kaputt)`)
  }
  const idx = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 15) {
      throw new AssetResolveError(`Palette '${rel}', ${name}: kein gültiger Farb-Index (0–15)`)
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
const DEFAULT_SPRITE_COLOR = 1

/**
 * Resolve a sprite id (`"player"`) to its animation frames' raw C64 bytes. Same
 * strict, eager contract as resolveCharset/resolveTilemap: unknown id / missing
 * file / wrong format all throw AssetResolveError at resolve time. Reads the
 * `.sprite`'s `frames` array — the editor's serializeSprite truth.
 */
export function resolveSprite(
  id: string,
  manifest: AssetManifest,
  readFile: AssetReader
): ResolvedSprite {
  const rel = manifest.sprites.find((s) => relMatches(s, id))
  if (!rel) {
    const known = manifest.sprites.map(idOf)
    const hint = known.length ? known.join(', ') : '(keine)'
    throw new AssetResolveError(`unbekanntes Sprite '${id}' — Projekt kennt: ${hint}`)
  }

  const text = readFile(rel)
  if (text === null) {
    throw new AssetResolveError(`Sprite-Datei fehlt: ${rel}`)
  }

  return { kind: 'sprite', id, rel, frames: parseSpriteFrames(rel, text), color: parseSpriteColor(text) }
}

/** Read the optional individual colour (0–15) from a `.sprite`; default white if
 *  absent (old files) or out of range. Parse errors are caught by parseSpriteFrames. */
function parseSpriteColor(text: string): number {
  try {
    const raw = JSON.parse(text) as { color?: unknown }
    const c = raw.color
    return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 15 ? c : DEFAULT_SPRITE_COLOR
  } catch {
    return DEFAULT_SPRITE_COLOR
  }
}

/**
 * Parse the `.sprite` JSON into one byte array per frame. Shape is
 * `{ frames: number[][] }` — each frame 63 bytes (the editor's serializeSprite
 * truth). Strict: a missing/empty `frames`, a wrong-length frame, or a bad byte
 * value is a hard error (the bake must not poke a garbled shape into sprite RAM).
 */
function parseSpriteFrames(rel: string, text: string): Uint8Array[] {
  let raw: { frames?: unknown }
  try {
    raw = JSON.parse(text) as { frames?: unknown }
  } catch {
    throw new AssetResolveError(`Sprite '${rel}' ist kein gültiges .sprite (JSON kaputt)`)
  }
  if (!Array.isArray(raw.frames) || raw.frames.length === 0) {
    throw new AssetResolveError(`Sprite '${rel}' hat keine 'frames'-Daten`)
  }

  const frames: Uint8Array[] = []
  for (let f = 0; f < raw.frames.length; f++) {
    const frame = raw.frames[f]
    if (!Array.isArray(frame) || frame.length !== SPRITE_BYTES) {
      throw new AssetResolveError(
        `Sprite '${rel}', Frame ${f}: erwartet ${SPRITE_BYTES} Bytes`
      )
    }
    const bytes = new Uint8Array(SPRITE_BYTES)
    for (let j = 0; j < SPRITE_BYTES; j++) {
      const b = frame[j]
      if (typeof b !== 'number' || b < 0 || b > 255 || !Number.isInteger(b)) {
        throw new AssetResolveError(
          `Sprite '${rel}', Frame ${f}, Byte ${j}: kein gültiger Bytewert (0–255)`
        )
      }
      bytes[j] = b
    }
    frames.push(bytes)
  }
  return frames
}

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
  charsets: string[]
  tilemaps: string[]
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

/** The basename of a manifest path without its extension: `main.petscii` → `main`.
 *  That stem is the asset id authors write in source. */
function stem(rel: string): string {
  const base = rel.split(/[\\/]/).pop() ?? rel
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
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
  const rel = manifest.charsets.find((c) => stem(c) === id)
  if (!rel) {
    const known = manifest.charsets.map(stem)
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
  const rel = manifest.tilemaps.find((m) => stem(m) === id)
  if (!rel) {
    const known = manifest.tilemaps.map(stem)
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

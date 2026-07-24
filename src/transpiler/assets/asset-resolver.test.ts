import { describe, it, expect } from 'vitest'
import {
  resolveCharset,
  resolveTilemap,
  resolveSprite,
  resolveImage,
  AssetResolveError,
  type AssetManifest,
  type AssetReader
} from './asset-resolver'

// The .bread asset bridge: id string → raw C64 charset bytes + metadata. Pure and
// IO-free, so every test injects a fake reader and a manifest — no filesystem.

const CHAR_COUNT = 256
const BYTES_PER_CHAR = 8

/** A valid `.petscii` JSON: 256 chars × 8 bytes. `edits` overrides specific chars
 *  so a test can assert exact bytes flow through unchanged. */
function petscii(edits: Record<number, number[]> = {}): string {
  const chars: number[][] = []
  for (let i = 0; i < CHAR_COUNT; i++) {
    chars.push(edits[i] ?? new Array(BYTES_PER_CHAR).fill(0))
  }
  return JSON.stringify({ format: 'breadcraft.petscii', version: 1, charCount: CHAR_COUNT, chars })
}

/** A reader backed by an in-memory file map; unknown paths read as missing. */
function reader(files: Record<string, string>): AssetReader {
  return (rel) => (rel in files ? files[rel] : null)
}

const manifest = (
  charsets: string[],
  tilemaps: string[] = [],
  sprites: string[] = [],
  palette: string | null = null,
  images: string[] = []
): AssetManifest => ({
  palette,
  charsets,
  tilemaps,
  sprites,
  images
})

const SPRITE_BYTES = 63

/** A valid `.sprite` JSON: `frames` of 63 bytes each. `frames` lets a test pass
 *  exact byte rows so it can assert they flow through unchanged. */
function spriteFile(frames: number[][] = [new Array(SPRITE_BYTES).fill(0)]): string {
  return JSON.stringify({ format: 'breadcraft.sprite', version: 1, frameCount: frames.length, frames })
}

describe('asset-resolver: resolveCharset (happy path)', () => {
  it('resolves an id to its .petscii by filename stem', () => {
    const r = resolveCharset(
      'main',
      manifest(['main.petscii']),
      reader({ 'main.petscii': petscii() })
    )
    expect(r.kind).toBe('charset')
    expect(r.id).toBe('main')
    expect(r.rel).toBe('main.petscii')
    expect(r.charCount).toBe(CHAR_COUNT)
    expect(r.bytes.length).toBe(CHAR_COUNT * BYTES_PER_CHAR)
  })

  it('passes the painted bytes through unchanged, row-major and flat', () => {
    const r = resolveCharset(
      'tiles',
      manifest(['tiles.petscii']),
      reader({ 'tiles.petscii': petscii({ 0: [1, 2, 3, 4, 5, 6, 7, 8], 5: [255, 0, 0, 0, 0, 0, 0, 9] }) })
    )
    // char 0 → bytes [0..7]
    expect(Array.from(r.bytes.slice(0, 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // char 5 → bytes [40..47]
    expect(Array.from(r.bytes.slice(40, 48))).toEqual([255, 0, 0, 0, 0, 0, 0, 9])
  })

  it('matches a sub-folder asset by its FULL project-relative path (P2.T0b)', () => {
    const r = resolveCharset(
      'assets/hero',
      manifest(['assets/hero.petscii']),
      reader({ 'assets/hero.petscii': petscii() })
    )
    expect(r.rel).toBe('assets/hero.petscii')
  })

  it('does NOT match a sub-folder asset by basename alone (no stem collision)', () => {
    expect(() =>
      resolveCharset('hero', manifest(['assets/hero.petscii']), reader({ 'assets/hero.petscii': petscii() }))
    ).toThrowError(/unbekanntes Tileset 'hero'/)
  })

  it('two same-basename assets in different folders are distinct by full path', () => {
    const m = manifest(['enemies/blob.petscii', 'props/blob.petscii'])
    const files = reader({
      'enemies/blob.petscii': petscii({ 0: [1, 0, 0, 0, 0, 0, 0, 0] }),
      'props/blob.petscii': petscii({ 0: [2, 0, 0, 0, 0, 0, 0, 0] })
    })
    expect(resolveCharset('enemies/blob', m, files).bytes[0]).toBe(1)
    expect(resolveCharset('props/blob', m, files).bytes[0]).toBe(2)
  })

  it('a root-level asset still matches by its short name (main.petscii → "main")', () => {
    const r = resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': petscii() }))
    expect(r.rel).toBe('main.petscii')
  })

  it('resolves per-slot solidity from the .petscii (STAHL S11)', () => {
    const text = JSON.stringify({
      format: 'breadcraft.petscii',
      charCount: CHAR_COUNT,
      chars: Array.from({ length: CHAR_COUNT }, () => new Array(BYTES_PER_CHAR).fill(0)),
      solid: [3, 200]
    })
    const r = resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': text }))
    expect(r.solid).toHaveLength(CHAR_COUNT)
    expect(r.solid[3]).toBe(true)
    expect(r.solid[200]).toBe(true)
    expect(r.solid[4]).toBe(false)
  })

  it('an untagged/old .petscii resolves to nothing solid (S11 default, tolerant)', () => {
    const r = resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': petscii() }))
    expect(r.solid).toHaveLength(CHAR_COUNT)
    expect(r.solid.some(Boolean)).toBe(false)
  })
})

describe('asset-resolver: resolveCharset (strict, eager errors)', () => {
  it('throws on an unknown id and lists what the project knows', () => {
    expect(() =>
      resolveCharset('ghost', manifest(['main.petscii']), reader({ 'main.petscii': petscii() }))
    ).toThrowError(/unbekanntes Tileset 'ghost'.*main/)
  })

  it('reports "(keine)" when the project has no charsets at all', () => {
    expect(() => resolveCharset('x', manifest([]), reader({}))).toThrowError(/keine/)
  })

  it('throws when the matched file is missing on disk', () => {
    // Manifest lists it, but the reader returns null (file gone).
    expect(() =>
      resolveCharset('main', manifest(['main.petscii']), reader({}))
    ).toThrowError(/Datei fehlt/)
  })

  it('throws on broken JSON', () => {
    expect(() =>
      resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': '{ not json' }))
    ).toThrowError(/kein gültiges \.petscii/)
  })

  it('throws when chars is absent', () => {
    expect(() =>
      resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': '{"format":"x"}' }))
    ).toThrowError(/keine 'chars'/)
  })

  it('throws when the char count is wrong', () => {
    const short = JSON.stringify({ chars: [[0, 0, 0, 0, 0, 0, 0, 0]] })
    expect(() =>
      resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': short }))
    ).toThrowError(/256/)
  })

  it('throws when a char row has the wrong byte length', () => {
    const chars: number[][] = new Array(CHAR_COUNT).fill(0).map(() => [0, 0, 0, 0, 0, 0, 0, 0])
    chars[7] = [1, 2, 3] // too short
    const bad = JSON.stringify({ chars })
    expect(() =>
      resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': bad }))
    ).toThrowError(/Zeichen 7.*8 Bytes/)
  })

  it('throws on an out-of-range byte value', () => {
    const chars: number[][] = new Array(CHAR_COUNT).fill(0).map(() => [0, 0, 0, 0, 0, 0, 0, 0])
    chars[3] = [0, 0, 0, 999, 0, 0, 0, 0] // 999 > 255
    const bad = JSON.stringify({ chars })
    expect(() =>
      resolveCharset('main', manifest(['main.petscii']), reader({ 'main.petscii': bad }))
    ).toThrowError(/Zeichen 3, Byte 3/)
  })

  it('raises AssetResolveError specifically (so the caller can attach position)', () => {
    try {
      resolveCharset('ghost', manifest([]), reader({}))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AssetResolveError)
    }
  })
})

// ---- resolveTilemap ----

const MAP_CELLS = 40 * 25 // 1000

/** A valid `.tilemap` JSON: one grafik layer of 1000 tile numbers. `edits`
 *  overrides specific cells so a test can assert exact tiles flow through. */
function tilemap(edits: Record<number, number> = {}): string {
  const tiles = new Array(MAP_CELLS).fill(0)
  for (const [i, n] of Object.entries(edits)) tiles[Number(i)] = n
  return JSON.stringify({ format: 'breadcraft.tilemap', version: 1, layers: [{ type: 'grafik', tiles }] })
}

describe('asset-resolver: resolveTilemap (happy path)', () => {
  it('resolves an id to its .tilemap by stem and returns 1000 tiles', () => {
    const r = resolveTilemap('level1', manifest([], ['level1.tilemap']), reader({ 'level1.tilemap': tilemap() }))
    expect(r.kind).toBe('tilemap')
    expect(r.id).toBe('level1')
    expect(r.rel).toBe('level1.tilemap')
    expect(r.tiles.length).toBe(MAP_CELLS)
    expect(r.width).toBe(40)
    expect(r.height).toBe(25)
  })

  it('passes painted tile numbers through unchanged', () => {
    const r = resolveTilemap('m', manifest([], ['m.tilemap']), reader({ 'm.tilemap': tilemap({ 0: 2, 41: 7, 999: 3 }) }))
    expect(r.tiles[0]).toBe(2)
    expect(r.tiles[41]).toBe(7)
    expect(r.tiles[999]).toBe(3)
    expect(r.tiles[1]).toBe(0)
  })

  it('reads the grafik layer even if a data layer comes first', () => {
    const tiles = new Array(MAP_CELLS).fill(0)
    tiles[5] = 9
    const json = JSON.stringify({
      layers: [{ type: 'daten', tiles: new Array(MAP_CELLS).fill(1) }, { type: 'grafik', tiles }]
    })
    const r = resolveTilemap('m', manifest([], ['m.tilemap']), reader({ 'm.tilemap': json }))
    expect(r.tiles[5]).toBe(9)
    expect(r.tiles[0]).toBe(0)
  })

  // S1.B2.T1: the bake follows the FILE's size. A pre-B2 map (no width/height) stays
  // one screen; a wide level resolves to width*height cells, so the codegen can see how
  // wide the world really is instead of quietly reading the first 1000 cells.
  it('resolves a map wider than the screen at its true size', () => {
    const w = 120
    const tiles = new Array(w * 25).fill(0)
    tiles[w * 3 + 119] = 55
    const json = JSON.stringify({ width: w, height: 25, layers: [{ type: 'grafik', tiles }] })
    const r = resolveTilemap('wide', manifest([], ['wide.tilemap']), reader({ 'wide.tilemap': json }))
    expect(r.width).toBe(w)
    expect(r.tiles.length).toBe(w * 25)
    expect(r.tiles[w * 3 + 119]).toBe(55)
  })
})

describe('asset-resolver: resolveTilemap (strict, eager errors)', () => {
  it('throws on unknown id and lists known maps', () => {
    expect(() =>
      resolveTilemap('ghost', manifest([], ['level1.tilemap']), reader({ 'level1.tilemap': tilemap() }))
    ).toThrowError(/unbekannte Karte 'ghost'.*level1/)
  })

  it('throws when the file is missing', () => {
    expect(() =>
      resolveTilemap('m', manifest([], ['m.tilemap']), reader({}))
    ).toThrowError(/Karten-Datei fehlt/)
  })

  it('throws on broken JSON', () => {
    expect(() =>
      resolveTilemap('m', manifest([], ['m.tilemap']), reader({ 'm.tilemap': '{ nope' }))
    ).toThrowError(/kein gültiges \.tilemap/)
  })

  it('throws when there is no grafik layer with tiles', () => {
    const json = JSON.stringify({ layers: [{ type: 'grafik' }] })
    expect(() =>
      resolveTilemap('m', manifest([], ['m.tilemap']), reader({ 'm.tilemap': json }))
    ).toThrowError(/keinen Grafik-Layer/)
  })

  it('throws on an out-of-range tile number', () => {
    const json = JSON.stringify({ layers: [{ type: 'grafik', tiles: [300] }] })
    expect(() =>
      resolveTilemap('m', manifest([], ['m.tilemap']), reader({ 'm.tilemap': json }))
    ).toThrowError(/Zelle 0/)
  })
})

// ---- resolveSprite ----

/** A 63-byte frame with a couple of bytes set, so a test can assert pass-through. */
function frame(edits: Record<number, number> = {}): number[] {
  const b = new Array(SPRITE_BYTES).fill(0)
  for (const [i, v] of Object.entries(edits)) b[Number(i)] = v
  return b
}

describe('asset-resolver: resolveSprite (happy path)', () => {
  it('resolves an id to its .sprite by stem and returns its frames', () => {
    const r = resolveSprite(
      'player',
      manifest([], [], ['player.sprite']),
      reader({ 'player.sprite': spriteFile() })
    )
    expect(r.kind).toBe('sprite')
    expect(r.id).toBe('player')
    expect(r.rel).toBe('player.sprite')
    expect(r.frames.length).toBe(1)
    expect(r.frames[0].length).toBe(SPRITE_BYTES)
  })

  it('passes painted sprite bytes through unchanged, per frame', () => {
    const r = resolveSprite(
      'p',
      manifest([], [], ['p.sprite']),
      reader({ 'p.sprite': spriteFile([frame({ 0: 255, 62: 9 })]) })
    )
    expect(r.frames[0][0]).toBe(255)
    expect(r.frames[0][62]).toBe(9)
    expect(r.frames[0][1]).toBe(0)
  })

  it('keeps multiple animation frames in order', () => {
    const r = resolveSprite(
      'p',
      manifest([], [], ['p.sprite']),
      reader({ 'p.sprite': spriteFile([frame({ 0: 1 }), frame({ 0: 2 }), frame({ 0: 3 })]) })
    )
    expect(r.frames.length).toBe(3)
    expect(r.frames[0][0]).toBe(1)
    expect(r.frames[1][0]).toBe(2)
    expect(r.frames[2][0]).toBe(3)
  })
})

describe('asset-resolver: resolveSprite (strict, eager errors)', () => {
  it('throws on unknown id and lists known sprites', () => {
    expect(() =>
      resolveSprite('ghost', manifest([], [], ['player.sprite']), reader({ 'player.sprite': spriteFile() }))
    ).toThrowError(/unbekanntes Sprite 'ghost'.*player/)
  })

  it('throws when the file is missing', () => {
    expect(() =>
      resolveSprite('p', manifest([], [], ['p.sprite']), reader({}))
    ).toThrowError(/Sprite-Datei fehlt/)
  })

  it('throws on broken JSON', () => {
    expect(() =>
      resolveSprite('p', manifest([], [], ['p.sprite']), reader({ 'p.sprite': '{ nope' }))
    ).toThrowError(/kein gültiges \.sprite/)
  })

  it('throws when there are no frames', () => {
    const json = JSON.stringify({ format: 'breadcraft.sprite', version: 1, frames: [] })
    expect(() =>
      resolveSprite('p', manifest([], [], ['p.sprite']), reader({ 'p.sprite': json }))
    ).toThrowError(/keine 'frames'-Daten/)
  })

  it('throws on a wrong-length frame', () => {
    const json = JSON.stringify({ frames: [new Array(10).fill(0)] })
    expect(() =>
      resolveSprite('p', manifest([], [], ['p.sprite']), reader({ 'p.sprite': json }))
    ).toThrowError(/Frame 0: erwartet 63 Bytes/)
  })

  it('throws on an out-of-range byte value', () => {
    const json = JSON.stringify({ frames: [frame({ 0: 300 })] })
    expect(() =>
      resolveSprite('p', manifest([], [], ['p.sprite']), reader({ 'p.sprite': json }))
    ).toThrowError(/Frame 0, Byte 0/)
  })

  it('raises AssetResolveError specifically', () => {
    try {
      resolveSprite('ghost', manifest([], [], []), reader({}))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AssetResolveError)
    }
  })
})

// ---- resolveImage ----

const IMG_BITMAP = 8000
const IMG_SCREEN = 1000
const IMG_COLOR = 1000

/** A valid `.image` JSON, with optional overrides to break one field per test. */
function imageFile(over: Partial<{ bitmap: number[]; screen: number[]; color: number[]; background: unknown }> = {}): string {
  return JSON.stringify({
    format: 'breadcraft.image',
    version: 1,
    background: 'background' in over ? over.background : 6,
    bitmap: over.bitmap ?? new Array(IMG_BITMAP).fill(0),
    screen: over.screen ?? new Array(IMG_SCREEN).fill(0),
    color: over.color ?? new Array(IMG_COLOR).fill(0)
  })
}

const imgManifest = (images: string[]): AssetManifest => manifest([], [], [], null, images)

describe('asset-resolver: resolveImage (happy path)', () => {
  it('resolves the four pieces to typed byte arrays + background', () => {
    const bitmap = new Array(IMG_BITMAP).fill(0)
    bitmap[0] = 0b11100100
    const screen = new Array(IMG_SCREEN).fill(0)
    screen[0] = 0x1a
    const color = new Array(IMG_COLOR).fill(0)
    color[0] = 5
    const r = resolveImage('title', imgManifest(['title.image']), reader({ 'title.image': imageFile({ bitmap, screen, color }) }))
    expect(r.kind).toBe('image')
    expect(r.bitmap.length).toBe(IMG_BITMAP)
    expect(r.screen.length).toBe(IMG_SCREEN)
    expect(r.color.length).toBe(IMG_COLOR)
    expect(r.bitmap[0]).toBe(0b11100100)
    expect(r.screen[0]).toBe(0x1a)
    expect(r.color[0]).toBe(5)
    expect(r.background).toBe(6)
  })

  it('defaults a missing background to black (0)', () => {
    const r = resolveImage('title', imgManifest(['title.image']), reader({ 'title.image': imageFile({ background: undefined }) }))
    expect(r.background).toBe(0)
  })
})

describe('asset-resolver: resolveImage (strict, eager errors)', () => {
  it('throws on an unknown id, listing what the project knows', () => {
    expect(() => resolveImage('ghost', imgManifest(['title.image']), reader({}))).toThrowError(
      /unbekanntes Bild 'ghost'.*title/
    )
  })

  it('throws when the file is missing on disk', () => {
    expect(() => resolveImage('title', imgManifest(['title.image']), reader({}))).toThrowError(
      /Bild-Datei fehlt/
    )
  })

  it('throws on broken JSON', () => {
    expect(() =>
      resolveImage('title', imgManifest(['title.image']), reader({ 'title.image': '{ nope' }))
    ).toThrowError(/kein gültiges \.image/)
  })

  it('throws on a wrong-length section', () => {
    expect(() =>
      resolveImage('title', imgManifest(['title.image']), reader({ 'title.image': imageFile({ bitmap: [0, 1, 2] }) }))
    ).toThrowError(/bitmap: erwartet 8000 Bytes/)
  })

  it('throws on an out-of-range byte value', () => {
    const bitmap = new Array(IMG_BITMAP).fill(0)
    bitmap[0] = 300
    expect(() =>
      resolveImage('title', imgManifest(['title.image']), reader({ 'title.image': imageFile({ bitmap }) }))
    ).toThrowError(/bitmap, Byte 0/)
  })

  it('throws on an out-of-range background index', () => {
    expect(() =>
      resolveImage('title', imgManifest(['title.image']), reader({ 'title.image': imageFile({ background: 99 }) }))
    ).toThrowError(/Hintergrund: kein gültiger Farb-Index/)
  })

  it('raises AssetResolveError specifically', () => {
    try {
      resolveImage('ghost', imgManifest([]), reader({}))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AssetResolveError)
    }
  })
})

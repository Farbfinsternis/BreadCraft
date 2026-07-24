import { describe, it, expect } from 'vitest'
import * as fmt from './index'

// The shared asset-format codecs (Befund 23): the ONE place the on-disk shape lives.
// These pin the structural contract both the renderer (tolerant) and the build
// resolver (strict) lean on — a field/dimension change here is meant to reach both.

describe('asset-formats: charset (.petscii)', () => {
  const rows = (): number[][] =>
    new Array(fmt.CHAR_COUNT).fill(0).map(() => new Array(fmt.BYTES_PER_CHAR).fill(0))

  it('round-trips 256 rows of 8 bytes through the format header', () => {
    const r = rows()
    r[5] = [1, 2, 3, 4, 5, 6, 7, 8]
    const json = JSON.parse(fmt.serializeCharset(r))
    expect(json.format).toBe('breadcraft.petscii')
    expect(json.charCount).toBe(fmt.CHAR_COUNT)
    expect(fmt.parseCharset(fmt.serializeCharset(r))[5]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('throws AssetFormatError with a predicate phrase on broken JSON', () => {
    try {
      fmt.parseCharset('{ not json')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(fmt.AssetFormatError)
      expect((e as Error).message).toMatch(/^ist kein gültiges \.petscii/)
    }
  })

  it('throws on missing chars and on the wrong char count', () => {
    expect(() => fmt.parseCharset('{"format":"x"}')).toThrowError(/hat keine 'chars'-Daten/)
    expect(() => fmt.parseCharset(JSON.stringify({ chars: [[0]] }))).toThrowError(
      /hat 1 Zeichen, erwartet 256/
    )
  })

  it('returns rows untouched — per-byte range is the caller policy', () => {
    const r = rows()
    r[0] = [999, -1, 0, 0, 0, 0, 0, 0] // out of range, but structurally fine
    expect(fmt.parseCharset(fmt.serializeCharset(r))[0]).toEqual([999, -1, 0, 0, 0, 0, 0, 0])
  })

  it('omits the solid tag when nothing is solid (untagged stays byte-identical, S11)', () => {
    const r = rows()
    expect(fmt.serializeCharset(r)).toBe(fmt.serializeCharset(r, new Array(256).fill(false)))
    expect(JSON.parse(fmt.serializeCharset(r))).not.toHaveProperty('solid')
  })

  it('round-trips per-slot solidity as a sparse slot list (S11)', () => {
    const r = rows()
    const solid = new Array<boolean>(256).fill(false)
    solid[5] = true
    solid[200] = true
    const json = JSON.parse(fmt.serializeCharset(r, solid))
    expect(json.solid).toEqual([5, 200]) // sparse, ascending slot numbers
    const back = fmt.parseCharsetSolid(fmt.serializeCharset(r, solid))
    expect(back[5]).toBe(true)
    expect(back[200]).toBe(true)
    expect(back[6]).toBe(false)
    expect(back).toHaveLength(256)
  })

  it('reads solidity tolerantly: old/malformed files yield all-false (S11)', () => {
    expect(fmt.parseCharsetSolid('{ not json').every((b) => !b)).toBe(true)
    expect(fmt.parseCharsetSolid(fmt.serializeCharset(rows())).every((b) => !b)).toBe(true)
    // out-of-range / non-integer slot numbers are ignored, valid ones still land
    const text = JSON.stringify({ chars: rows(), solid: [3, 999, -1, 2.5, 7] })
    const flags = fmt.parseCharsetSolid(text)
    expect(flags[3]).toBe(true)
    expect(flags[7]).toBe(true)
    expect(flags.filter(Boolean)).toHaveLength(2)
  })
})

describe('asset-formats: tilemap (.tilemap)', () => {
  it('round-trips tiles + colors in the future-proof layer array', () => {
    const tiles = new Array(fmt.MAP_CELLS).fill(0)
    const colors = new Array(fmt.MAP_CELLS).fill(fmt.DEFAULT_COLOR_RAM)
    tiles[5] = 42
    colors[5] = 7
    const json = JSON.parse(fmt.serializeTilemap(tiles, colors))
    expect(json.format).toBe('breadcraft.tilemap')
    expect(json.layers[0].type).toBe('grafik')
    const back = fmt.parseTilemap(fmt.serializeTilemap(tiles, colors))
    expect(back.tiles[5]).toBe(42)
    expect(back.colors?.[5]).toBe(7)
  })

  it('reports colors as null for files predating per-cell Color-RAM', () => {
    const json = JSON.stringify({ layers: [{ type: 'grafik', tiles: [1, 2, 3] }] })
    const back = fmt.parseTilemap(json)
    expect(back.tiles).toEqual([1, 2, 3])
    expect(back.colors).toBeNull()
  })

  it('finds the grafik layer by type even if not first', () => {
    const json = JSON.stringify({
      layers: [{ type: 'daten', tiles: [9] }, { type: 'grafik', tiles: [4] }]
    })
    expect(fmt.parseTilemap(json).tiles).toEqual([4])
  })

  it('throws on broken JSON, missing layers, and no grafik tiles', () => {
    expect(() => fmt.parseTilemap('{ nope')).toThrowError(/ist kein gültiges \.tilemap/)
    expect(() => fmt.parseTilemap('{"format":"x"}')).toThrowError(/hat keine 'layers'-Daten/)
    expect(() => fmt.parseTilemap(JSON.stringify({ layers: [{ type: 'grafik' }] }))).toThrowError(
      /hat keinen Grafik-Layer mit Kacheln/
    )
  })

  // S1.B2.T1: the file's own size is now READ, not assumed. A map may be wider than
  // one screen (the scrolling world); a file without the fields is a pre-B2 map and
  // is exactly one screen — that is what those files always were.
  it('reads the declared size and round-trips a wider-than-screen map', () => {
    const w = fmt.SCREEN_W * 3
    const tiles = new Array(w * fmt.SCREEN_H).fill(0)
    tiles[w * 2 + 100] = 77 // a cell only a wide map even has
    const json = JSON.parse(fmt.serializeTilemap(tiles, [], w, fmt.SCREEN_H))
    expect(json.width).toBe(w)
    const back = fmt.parseTilemap(fmt.serializeTilemap(tiles, [], w, fmt.SCREEN_H))
    expect(back.width).toBe(w)
    expect(back.height).toBe(fmt.SCREEN_H)
    expect(back.tiles[w * 2 + 100]).toBe(77)
  })

  it('treats a map without width/height as exactly one screen', () => {
    const back = fmt.parseTilemap(JSON.stringify({ layers: [{ type: 'grafik', tiles: [1] }] }))
    expect(back.width).toBe(fmt.SCREEN_W)
    expect(back.height).toBe(fmt.SCREEN_H)
  })

  // A garbled dimension is NOT quietly repaired: sizing the grid off a bad number
  // would shear the whole level (every row offset), which looks like corrupted art
  // rather than a broken file.
  it('throws on an impossible size instead of guessing', () => {
    const bad = (w: unknown, h: unknown): string =>
      JSON.stringify({ width: w, height: h, layers: [{ type: 'grafik', tiles: [1] }] })
    expect(() => fmt.parseTilemap(bad(0, 25))).toThrowError(/unmögliche Größe/)
    expect(() => fmt.parseTilemap(bad(40.5, 25))).toThrowError(/unmögliche Größe/)
    expect(() => fmt.parseTilemap(bad('40', 25))).toThrowError(/unmögliche Größe/)
    expect(() => fmt.parseTilemap(bad(fmt.MAX_MAP_W + 1, 25))).toThrowError(/unmögliche Größe/)
    // Vertical scrolling is deferred, so a map is one screen tall — nothing else.
    expect(() => fmt.parseTilemap(bad(40, 50))).toThrowError(/unmögliche Größe/)
  })
})

describe('asset-formats: palette (.palette)', () => {
  it('round-trips the three shared indices, raw', () => {
    const json = JSON.parse(fmt.serializePalette({ background: 0, shared1: 9, shared2: 14 }))
    expect(json.format).toBe('breadcraft.palette')
    const back = fmt.parsePalette(fmt.serializePalette({ background: 1, shared1: 2, shared2: 3 }))
    expect(back).toEqual({ background: 1, shared1: 2, shared2: 3 })
  })

  it('throws AssetFormatError on broken JSON', () => {
    expect(() => fmt.parsePalette('{ nope')).toThrowError(/ist kein gültiges \.palette/)
  })
})

describe('asset-formats: sprite (.sprite)', () => {
  it('parses frames AND colour from ONE parse (Befund 25)', () => {
    const json = fmt.serializeSprite([new Array(fmt.SPRITE_BYTES).fill(0)], 6)
    const back = fmt.parseSprite(json)
    expect(JSON.parse(json).format).toBe('breadcraft.sprite')
    expect(back.frames.length).toBe(1)
    expect(back.color).toBe(6)
  })

  it('allows an empty frames array (caller decides: error or blank frame)', () => {
    const back = fmt.parseSprite(JSON.stringify({ frames: [] }))
    expect(back.frames).toEqual([])
  })

  it('reports a missing colour as undefined (caller defaults it)', () => {
    const back = fmt.parseSprite(JSON.stringify({ frames: [[1]] }))
    expect(back.color).toBeUndefined()
  })

  it('throws on broken JSON and on non-array frames', () => {
    expect(() => fmt.parseSprite('{ nope')).toThrowError(/ist kein gültiges \.sprite/)
    expect(() => fmt.parseSprite('{"format":"x"}')).toThrowError(/hat keine 'frames'-Daten/)
  })
})

describe('asset-formats: image (.image)', () => {
  const bitmap = Array.from({ length: fmt.IMAGE_BITMAP_BYTES }, (_, i) => i % 256)
  const screen = Array.from({ length: fmt.IMAGE_SCREEN_BYTES }, (_, i) => (i * 7) % 256)
  const color = Array.from({ length: fmt.IMAGE_COLOR_BYTES }, (_, i) => (i * 3) % 16)

  it('round-trips the four pieces structurally identically', () => {
    const json = fmt.serializeImage(bitmap, screen, color, 6)
    expect(JSON.parse(json).format).toBe('breadcraft.image')
    const back = fmt.parseImage(json)
    expect(back.bitmap).toEqual(bitmap)
    expect(back.screen).toEqual(screen)
    expect(back.color).toEqual(color)
    expect(back.background).toBe(6)
  })

  it('reports a missing background as undefined (caller defaults it)', () => {
    const back = fmt.parseImage(JSON.stringify({ bitmap: [], screen: [], color: [] }))
    expect(back.background).toBeUndefined()
  })

  it('throws on broken JSON and on a missing section', () => {
    expect(() => fmt.parseImage('{ nope')).toThrowError(/ist kein gültiges \.image/)
    expect(() => fmt.parseImage('{"bitmap":[],"screen":[]}')).toThrowError(/hat keine 'color'-Daten/)
  })
})

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

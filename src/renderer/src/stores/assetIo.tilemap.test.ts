import { describe, it, expect } from 'vitest'
import { serializeTilemap, parseTilemap, MAP_W, MAP_H, DEFAULT_COLOR_RAM } from './assetIo'

// The .tilemap on-disk format: a 40×25 graphics layer of tile numbers PLUS per-cell
// Color-RAM colours (0–15), stored as a future-proof layer ARRAY (TILEMAP_EDITOR.md
// §4). These tests pin the roundtrip, Color-RAM forward-compat, and defensive parsing.

const CELLS = MAP_W * MAP_H // 1000

function fullMap(fill: (i: number) => number): Uint8Array {
  const t = new Uint8Array(CELLS)
  for (let i = 0; i < CELLS; i++) t[i] = fill(i)
  return t
}

function data(tiles: Uint8Array, colors?: Uint8Array): { tiles: Uint8Array; colors: Uint8Array } {
  return { tiles, colors: colors ?? new Uint8Array(CELLS).fill(DEFAULT_COLOR_RAM) }
}

describe('assetIo: tilemap serialize/parse', () => {
  it('roundtrips a painted map (tiles + Color-RAM) unchanged', () => {
    const tiles = fullMap((i) => i % 256)
    const colors = fullMap((i) => i % 16)
    const back = parseTilemap(serializeTilemap(data(tiles, colors)))
    expect(back).not.toBeNull()
    expect(Array.from(back!.tiles)).toEqual(Array.from(tiles))
    expect(Array.from(back!.colors)).toEqual(Array.from(colors))
  })

  it('emits the future-proof layer-array shape with tiles + colors', () => {
    const json = JSON.parse(serializeTilemap(data(new Uint8Array(CELLS))))
    expect(json.format).toBe('breadcraft.tilemap')
    expect(json.width).toBe(MAP_W)
    expect(json.height).toBe(MAP_H)
    expect(Array.isArray(json.layers)).toBe(true)
    expect(json.layers[0].type).toBe('grafik')
    expect(json.layers[0].tiles).toHaveLength(CELLS)
    expect(json.layers[0].colors).toHaveLength(CELLS)
  })

  it('defaults Color-RAM for files that predate it (no colors array)', () => {
    const tiles = new Array(CELLS).fill(0)
    tiles[5] = 42
    const json = JSON.stringify({
      format: 'breadcraft.tilemap',
      version: 1,
      layers: [{ type: 'grafik', tiles }] // no colors — an old file
    })
    const back = parseTilemap(json)
    expect(back).not.toBeNull()
    expect(back!.tiles[5]).toBe(42)
    expect(back!.colors.every((c) => c === DEFAULT_COLOR_RAM)).toBe(true)
  })

  it('reads the grafik layer by type even if not first', () => {
    const tiles = new Array(CELLS).fill(0)
    tiles[5] = 42
    const json = JSON.stringify({
      format: 'breadcraft.tilemap',
      version: 1,
      layers: [{ type: 'daten', tiles: new Array(CELLS).fill(7) }, { type: 'grafik', tiles }]
    })
    const back = parseTilemap(json)
    expect(back!.tiles[5]).toBe(42)
    expect(back!.tiles[0]).toBe(0)
  })

  it('clamps out-of-range tile + colour values', () => {
    const tiles = new Array(CELLS).fill(0)
    tiles[0] = 999
    tiles[1] = -4
    const colors = new Array(CELLS).fill(0)
    colors[0] = 99 // out of 0–15
    colors[1] = 7
    const back = parseTilemap(JSON.stringify({ layers: [{ type: 'grafik', tiles, colors }] }))
    expect(back!.tiles[0]).toBe(0)
    expect(back!.tiles[1]).toBe(0)
    expect(back!.colors[0]).toBe(DEFAULT_COLOR_RAM) // invalid → default
    expect(back!.colors[1]).toBe(7)
  })

  it('returns null on broken JSON', () => {
    expect(parseTilemap('{ not json')).toBeNull()
  })

  it('returns null when layers is missing', () => {
    expect(parseTilemap('{"format":"x"}')).toBeNull()
  })

  it('returns null when no layer has tiles', () => {
    expect(parseTilemap(JSON.stringify({ layers: [{ type: 'grafik' }] }))).toBeNull()
  })
})

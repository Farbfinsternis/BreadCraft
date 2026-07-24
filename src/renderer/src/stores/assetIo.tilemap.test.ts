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

function data(
  tiles: Uint8Array,
  colors?: Uint8Array,
  width = MAP_W,
  height = MAP_H
): { tiles: Uint8Array; colors: Uint8Array; width: number; height: number } {
  return {
    tiles,
    colors: colors ?? new Uint8Array(tiles.length).fill(DEFAULT_COLOR_RAM),
    width,
    height
  }
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

  // S1.B2.T1: the editor sizes its grids from the FILE, so a level three screens wide
  // survives a save/load unchanged — including the cells a one-screen map has no room for.
  it('roundtrips a map wider than one screen', () => {
    const w = MAP_W * 3
    const tiles = new Uint8Array(w * MAP_H)
    tiles[w * 4 + (w - 1)] = 99 // last column of a wide row — past a 40-wide grid
    const back = parseTilemap(serializeTilemap(data(tiles, undefined, w, MAP_H)))
    expect(back).not.toBeNull()
    expect(back!.width).toBe(w)
    expect(back!.tiles).toHaveLength(w * MAP_H)
    expect(back!.tiles[w * 4 + (w - 1)]).toBe(99)
  })

  it('loads a map without width/height as one screen', () => {
    const back = parseTilemap(JSON.stringify({ layers: [{ type: 'grafik', tiles: [1, 2, 3] }] }))
    expect(back!.width).toBe(MAP_W)
    expect(back!.height).toBe(MAP_H)
    expect(back!.tiles).toHaveLength(CELLS) // short layer pads — tolerant policy
  })

  it('returns null on an impossible declared size (rather than shearing the level)', () => {
    const json = JSON.stringify({ width: 7, height: 25, layers: [{ type: 'grafik', tiles: [1] }] })
    expect(parseTilemap(json)).toBeNull()
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

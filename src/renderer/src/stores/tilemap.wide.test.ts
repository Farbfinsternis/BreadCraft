import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTilemapStore, EMPTY_TILE } from './tilemap'
import { serializeTilemap, MAP_W, MAP_H, DEFAULT_COLOR_RAM } from './assetIo'

// S1.B2.T1: a map is as wide as its FILE says, not as wide as a constant. The store
// must load a level wider than one screen, address its far columns correctly
// (cell = row*width + col — the seam where a hardcoded 40 would silently shear the
// level), keep that width across clear(), and write it back unchanged.

const WIDE_W = MAP_W * 3 // three screens of level

/** A wide map with one recognisable cell in a column no one-screen map even has. */
function wideMapJson(): { json: string; markCol: number; markRow: number } {
  const markCol = WIDE_W - 1
  const markRow = 7
  const tiles = new Uint8Array(WIDE_W * MAP_H).fill(EMPTY_TILE)
  const colors = new Uint8Array(WIDE_W * MAP_H).fill(DEFAULT_COLOR_RAM)
  tiles[markRow * WIDE_W + markCol] = 137
  colors[markRow * WIDE_W + markCol] = 5
  return {
    json: serializeTilemap({ tiles, colors, width: WIDE_W, height: MAP_H }),
    markCol,
    markRow
  }
}

/** Minimal asset IPC: hands back one file's text and records what gets written. */
function stubAssets(text: string): { written: string[] } {
  const written: string[] = []
  ;(globalThis as { window?: unknown }).window = {
    breadcraft: {
      assets: {
        read: async () => text,
        write: async (_d: string, _k: string, _rel: string, t: string) => {
          written.push(t)
        }
      }
    }
  }
  return { written }
}

describe('tilemap store: a level wider than the screen', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('loads the size from the file and reaches its far columns', async () => {
    const { json, markCol, markRow } = wideMapJson()
    stubAssets(json)
    const tm = useTilemapStore()

    await tm.loadForProject('C:/proj', 'assets/level01.tilemap')

    expect(tm.width).toBe(WIDE_W)
    expect(tm.height).toBe(MAP_H)
    expect(tm.tiles.length).toBe(WIDE_W * MAP_H)
    expect(tm.tileAt(markCol, markRow)).toBe(137)
    expect(tm.colorAt(markCol, markRow)).toBe(5)
    // Painting past the last column is still outside the map, wide or not.
    tm.setTile(WIDE_W, markRow, 200, 3)
    expect(tm.tileAt(WIDE_W, markRow)).toBe(EMPTY_TILE)
  })

  // S1.B2.T3: growing is where a row-major grid bites — every row moves to a new stride,
  // so a naive "append cells" would shear the whole level one row at a time.
  it('grows without shearing what is already painted', () => {
    const tm = useTilemapStore()
    // A recognisable pattern: the first and last cell of every row.
    for (let row = 0; row < MAP_H; row++) {
      tm.setTile(0, row, 100 + row, 3)
      tm.setTile(MAP_W - 1, row, 200 - row, 4)
    }

    tm.growTo(MAP_W * 2)

    expect(tm.width).toBe(MAP_W * 2)
    expect(tm.tiles.length).toBe(MAP_W * 2 * MAP_H)
    for (let row = 0; row < MAP_H; row++) {
      expect(tm.tileAt(0, row)).toBe(100 + row)
      expect(tm.tileAt(MAP_W - 1, row)).toBe(200 - row)
      expect(tm.colorAt(MAP_W - 1, row)).toBe(4)
      // The new land is empty, not a copy of anything.
      expect(tm.tileAt(MAP_W, row)).toBe(EMPTY_TILE)
      expect(tm.tileAt(MAP_W * 2 - 1, row)).toBe(EMPTY_TILE)
    }
    expect(tm.dirty).toBe(true)
  })

  // The other half of growing (user report 2026-07-24): a tile dropped into the next
  // screen by accident grows the level, so rubbing it out has to hand that screen back
  // — otherwise the level silently carries a screen of nothing, which the C64 pays for
  // in RAM.
  it('hands back trailing screens that hold nothing', () => {
    const tm = useTilemapStore()
    tm.growTo(MAP_W * 3)
    tm.setTile(MAP_W + 5, 4, 130, 2) // one tile, in screen 2

    tm.trimEmptyScreens(MAP_W)
    expect(tm.width).toBe(MAP_W * 2) // screen 3 was empty → gone; screen 2 is painted

    tm.setTile(MAP_W + 5, 4, EMPTY_TILE, 1) // rub it out again
    tm.trimEmptyScreens(MAP_W)
    expect(tm.width).toBe(MAP_W) // back to where it started
  })

  it('never trims away painted work', () => {
    const tm = useTilemapStore()
    tm.growTo(MAP_W * 3)
    tm.setTile(MAP_W * 3 - 1, MAP_H - 1, 77, 5) // the very last cell of the level
    tm.trimEmptyScreens(MAP_W)
    expect(tm.width).toBe(MAP_W * 3)
    expect(tm.tileAt(MAP_W * 3 - 1, MAP_H - 1)).toBe(77)
  })

  it('keeps the first screen even when the map is completely empty', () => {
    // There is no zero-screen level.
    const tm = useTilemapStore()
    tm.trimEmptyScreens(MAP_W)
    expect(tm.width).toBe(MAP_W)
  })

  it('never shrinks a level by growing', () => {
    const tm = useTilemapStore()
    tm.growTo(MAP_W * 3)
    tm.setTile(MAP_W * 3 - 1, 0, 55, 2)
    tm.growTo(MAP_W) // a smaller target must not take painted work with it
    expect(tm.width).toBe(MAP_W * 3)
    expect(tm.tileAt(MAP_W * 3 - 1, 0)).toBe(55)
  })

  it('keeps the width when the map is emptied and when it is saved', async () => {
    const { json, markCol, markRow } = wideMapJson()
    const { written } = stubAssets(json)
    const tm = useTilemapStore()
    await tm.loadForProject('C:/proj', 'assets/level01.tilemap')

    // clear() empties the level, it does not shrink it back to one screen.
    tm.clear()
    expect(tm.width).toBe(WIDE_W)
    expect(tm.tiles.length).toBe(WIDE_W * MAP_H)
    expect(tm.tileAt(markCol, markRow)).toBe(EMPTY_TILE)

    tm.setTile(markCol, markRow, 42, 6)
    await tm.save()

    const back = JSON.parse(written.at(-1) as string)
    expect(back.width).toBe(WIDE_W)
    expect(back.height).toBe(MAP_H)
    expect(back.layers[0].tiles[markRow * WIDE_W + markCol]).toBe(42)
  })
})

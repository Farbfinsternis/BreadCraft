import { describe, it, expect } from 'vitest'
import { levelCost, bytesPerScreen, TILE_COLOR_TABLE, type LevelShape } from './level-cost'

// S1.B3.1. The C64's Color-RAM is per cell, so painting a tile in two colours is allowed
// — it just costs a second byte per cell in the level data. The model is CHOSEN by what
// was painted, never imposed, and the price is told. (The real ITD map turned out to
// paint 4 of its 40 tiles in more than one colour, which is what settled this design.)

const W = 40
const BAND_TOP = 3
const BAND_ROWS = 10
const MAP_H = 25

/** A map where `paint(col,row)` gives [tile, colour] for the cells inside the band. */
function map(paint: (col: number, row: number) => [number, number], width = W): LevelShape {
  const tiles = new Uint8Array(width * MAP_H)
  const colors = new Uint8Array(width * MAP_H)
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < width; col++) {
      const [t, c] = paint(col, row)
      tiles[row * width + col] = t
      colors[row * width + col] = c
    }
  }
  return { tiles, colors, width, bandTop: BAND_TOP, bandRows: BAND_ROWS }
}

describe('level cost: which colour model a painted level needs', () => {
  it('takes the cheap table when every tile keeps one colour', () => {
    const cost = levelCost(
      map((col, row) => [70 + (row % 3), 2 + (row % 3)]),
      MAP_H
    )
    expect(cost.model).toBe('tileTable')
    expect(cost.conflictTiles).toEqual([])
    expect(cost.bytes).toBe(W * BAND_ROWS + TILE_COLOR_TABLE)
    expect(bytesPerScreen(cost.model, W, BAND_ROWS)).toBe(400)
    // The table says which colour each tile carries.
    expect(cost.tileColors?.[70]).toBe(2)
    expect(cost.tileColors?.[72]).toBe(4)
  })

  it('pays per cell when a tile is painted in two colours, and says which', () => {
    const cost = levelCost(
      map((col, row) => [80, col === 5 && row === 5 ? 7 : 1]),
      MAP_H
    )
    expect(cost.model).toBe('perCell')
    expect(cost.conflictTiles).toEqual([80])
    expect(cost.bytes).toBe(W * BAND_ROWS * 2)
    expect(bytesPerScreen(cost.model, W, BAND_ROWS)).toBe(800)
    expect(cost.tileColors).toBeNull()
  })

  it('lists every clashing tile, in a stable order', () => {
    const cost = levelCost(
      map((col, row) => {
        if (row === 4) return [90, col === 0 ? 1 : 2]
        if (row === 6) return [85, col === 0 ? 3 : 4]
        return [70, 5]
      }),
      MAP_H
    )
    expect(cost.conflictTiles).toEqual([85, 90])
  })

  // Rows outside the play field stand still while the world scrolls — they are HUD, not
  // level data. A score line painted in five colours must not make the LEVEL expensive.
  it('ignores everything outside the play-field band', () => {
    const cost = levelCost(
      map((col, row) => {
        const inBand = row >= BAND_TOP && row < BAND_TOP + BAND_ROWS
        return inBand ? [70, 5] : [70, col & 15] // the same tile, all colours, in the HUD
      }),
      MAP_H
    )
    expect(cost.model).toBe('tileTable')
    expect(cost.bytes).toBe(W * BAND_ROWS + TILE_COLOR_TABLE)
  })

  it('scales with the level, not with the screen', () => {
    const wide = levelCost(
      map((col, row) => [70 + (row % 2), 3 + (row % 2)], W * 4),
      MAP_H
    )
    expect(wide.bytes).toBe(W * 4 * BAND_ROWS + TILE_COLOR_TABLE)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTilemapStore, EMPTY_TILE } from './tilemap'
import { DEFAULT_COLOR_RAM, MAP_W, MAP_H } from './assetIo'

// TILEMAP_EDITOR_UX 2026-06-23, T1: "empty" = Space (screen code 32), NOT slot 0
// (which is `@`). A fresh map and clear() must fill every cell with EMPTY_TILE so an
// untouched / cleared map renders blank, and the editor's "filled" counter must read 0.

const CELLS = MAP_W * MAP_H

describe('tilemap store: clear() / empty default', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('the empty tile is Space (32), not slot 0', () => {
    expect(EMPTY_TILE).toBe(32)
  })

  it('a fresh map starts entirely empty (every cell = Space)', () => {
    const tm = useTilemapStore()
    expect(tm.tiles.length).toBe(CELLS)
    expect(tm.tiles.every((t) => t === EMPTY_TILE)).toBe(true)
    expect(tm.colors.every((c) => c === DEFAULT_COLOR_RAM)).toBe(true)
  })

  it('clear() resets a painted map back to all-empty and marks it dirty', () => {
    const tm = useTilemapStore()
    tm.setTile(3, 4, 130, 5)
    tm.setTile(0, 0, 200, 7)
    expect(tm.tileAt(3, 4)).toBe(130)
    const v = tm.version

    tm.clear()

    expect(tm.tiles.every((t) => t === EMPTY_TILE)).toBe(true)
    expect(tm.colors.every((c) => c === DEFAULT_COLOR_RAM)).toBe(true)
    expect(tm.tileAt(3, 4)).toBe(EMPTY_TILE)
    expect(tm.dirty).toBe(true)
    expect(tm.version).toBeGreaterThan(v)
  })

  it('out-of-bounds reads as empty (Space), not slot 0', () => {
    const tm = useTilemapStore()
    expect(tm.tileAt(-1, 0)).toBe(EMPTY_TILE)
    expect(tm.tileAt(MAP_W, MAP_H)).toBe(EMPTY_TILE)
  })
})

import { describe, it, expect } from 'vitest'
import { spritePixelHexes, spriteGridDims, SPRITE_PREVIEW_CELLS } from './spriteRender'

const PALETTE = ['#000000', '#ff0000', '#00ff00', '#0000ff'] // transparent, s1, sprite, s2

describe('spriteRender: grid dims', () => {
  it('hi-res = 24 wide, cellW 1', () => {
    expect(spriteGridDims(false)).toEqual({ gw: 24, gh: 21, cellW: 1 })
  })
  it('multicolor = 12 wide double-pixels, cellW 2', () => {
    expect(spriteGridDims(true)).toEqual({ gw: 12, gh: 21, cellW: 2 })
  })
})

describe('spriteRender: spritePixelHexes', () => {
  it('always returns 504 entries (24×21 C64 pixels), hi-res', () => {
    const out = spritePixelHexes(new Uint8Array(504), PALETTE, false)
    expect(out.length).toBe(SPRITE_PREVIEW_CELLS)
    expect(out.every((h) => h === PALETTE[0])).toBe(true)
  })

  it('always returns 504 entries in MC too (double-pixels expanded)', () => {
    const out = spritePixelHexes(new Uint8Array(252), PALETTE, true)
    expect(out.length).toBe(SPRITE_PREVIEW_CELLS)
  })

  it('maps the top-left hi-res pixel to its index colour', () => {
    const cells = new Uint8Array(504)
    cells[0] = 2 // sprite colour
    const out = spritePixelHexes(cells, PALETTE, false)
    expect(out[0]).toBe(PALETTE[2])
    expect(out[1]).toBe(PALETTE[0])
  })

  it('expands an MC double-pixel to two adjacent preview cells', () => {
    const cells = new Uint8Array(252)
    cells[0] = 1 // leftmost double-pixel of row 0
    const out = spritePixelHexes(cells, PALETTE, true)
    expect(out[0]).toBe(PALETTE[1])
    expect(out[1]).toBe(PALETTE[1]) // same colour spans 2 C64 pixels
    expect(out[2]).toBe(PALETTE[0])
  })

  it('places the bottom-right hi-res pixel at index 503', () => {
    const cells = new Uint8Array(504)
    cells[503] = 3
    const out = spritePixelHexes(cells, PALETTE, false)
    expect(out[503]).toBe(PALETTE[3])
  })

  it('reads undefined/short data as transparent (index 0)', () => {
    const out = spritePixelHexes(undefined, PALETTE, false)
    expect(out.length).toBe(SPRITE_PREVIEW_CELLS)
    expect(out.every((h) => h === PALETTE[0])).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { C64_ROM_FONT_UPPER, ROM_GLYPH_BYTES, romGlyph, romGlyphBits } from './c64-rom-font'

const T = true
const F = false

describe('c64-rom-font (uppercase/graphics bank)', () => {
  it('holds exactly 256 glyphs of 8 bytes', () => {
    expect(C64_ROM_FONT_UPPER.length).toBe(256 * ROM_GLYPH_BYTES)
    expect(ROM_GLYPH_BYTES).toBe(8)
  })

  it('matches the known ROM bitmaps for @, A and H', () => {
    expect(romGlyph(0)).toEqual([0x3c, 0x66, 0x6e, 0x6e, 0x60, 0x62, 0x3c, 0x00]) // @
    expect(romGlyph(1)).toEqual([0x18, 0x3c, 0x66, 0x7e, 0x66, 0x66, 0x66, 0x00]) // A
    expect(romGlyph(8)).toEqual([0x66, 0x66, 0x66, 0x7e, 0x66, 0x66, 0x66, 0x00]) // H
  })

  it('has a blank glyph for the space slot', () => {
    expect(romGlyph(32)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('returns a blank glyph for an out-of-range slot', () => {
    expect(romGlyph(-1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(romGlyph(256)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('romGlyphBits unpacks 64 booleans, MSB leftmost (top row of A = 0x18)', () => {
    const bits = romGlyphBits(1) // 'A'
    expect(bits.length).toBe(64)
    // row 0 = 0x18 = 0b00011000 → cols 3 and 4 set
    expect(bits.slice(0, 8)).toEqual([F, F, F, T, T, F, F, F])
    // space is entirely blank
    expect(romGlyphBits(32).every((b) => b === false)).toBe(true)
  })
})

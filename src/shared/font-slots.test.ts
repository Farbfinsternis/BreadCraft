import { describe, it, expect } from 'vitest'
import { charForSlot, FONT_SLOTS, seedFontRegion } from './font-slots'
import { C64_ROM_FONT_UPPER } from './c64-rom-font'

describe('charForSlot (Font-Linse slot → character)', () => {
  it('maps slots 1–26 to A–Z and 0 to @', () => {
    expect(charForSlot(0)).toBe('@')
    expect(charForSlot(1)).toBe('A')
    expect(charForSlot(8)).toBe('H')
    expect(charForSlot(26)).toBe('Z')
  })

  it('maps the 32–63 block to space, digits and punctuation', () => {
    expect(charForSlot(32)).toBe(' ')
    expect(charForSlot(48)).toBe('0')
    expect(charForSlot(57)).toBe('9')
    expect(charForSlot(33)).toBe('!')
    expect(charForSlot(63)).toBe('?')
  })

  it('has no font glyph (null) for the graphics/non-ASCII slots', () => {
    expect(charForSlot(28)).toBeNull() // £
    expect(charForSlot(30)).toBeNull() // ↑
    expect(charForSlot(64)).toBeNull() // graphics region
    expect(charForSlot(200)).toBeNull()
  })
})

describe('seedFontRegion (F2 — ROM font into empty Hires font slots)', () => {
  const FONT_BYTES = FONT_SLOTS * 8

  it('fills an empty font slot with the matching ROM glyph', () => {
    const out = seedFontRegion(new Uint8Array(2048))
    // slot 0 = '@', slot 8 = 'H' — straight from the ROM font.
    expect(Array.from(out.slice(0, 8))).toEqual(C64_ROM_FONT_UPPER.slice(0, 8))
    expect(Array.from(out.slice(64, 72))).toEqual(C64_ROM_FONT_UPPER.slice(64, 72))
  })

  it('keeps a painted font slot untouched (painted glyph wins)', () => {
    const bytes = new Uint8Array(2048)
    bytes.set([1, 2, 3, 4, 5, 6, 7, 8], 8) // slot 1 painted
    const out = seedFontRegion(bytes)
    expect(Array.from(out.slice(8, 16))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('never touches tile territory (slots ≥ 64) and does not mutate the input', () => {
    const bytes = new Uint8Array(2048)
    const out = seedFontRegion(bytes)
    expect(out).not.toBe(bytes) // a new array
    expect(Array.from(bytes.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // input untouched
    expect(Array.from(out.slice(FONT_BYTES, FONT_BYTES + 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // slot 64 stays empty
  })
})

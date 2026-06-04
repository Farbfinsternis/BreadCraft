import { describe, it, expect } from 'vitest'
import { slotsForMode, SLOTS } from './palette'

// slotsForMode picks which palette slots a graphics mode actually uses
// (PALETTE_EDITOR.md §4): hi-res = background only, multicolor = all three.

describe('palette: slotsForMode', () => {
  it('hi-res shows only the background slot', () => {
    const keys = slotsForMode('TEXT_HIRES').map((s) => s.key)
    expect(keys).toEqual(['background'])
  })

  it('text-multicolor shows all three shared slots', () => {
    const keys = slotsForMode('TEXT_MULTICOLOR').map((s) => s.key)
    expect(keys).toEqual(['background', 'shared1', 'shared2'])
  })

  it('bitmap-multicolor also uses the shared registers', () => {
    expect(slotsForMode('BITMAP_MULTICOLOR')).toEqual(SLOTS)
  })
})

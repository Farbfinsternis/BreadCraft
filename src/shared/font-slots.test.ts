import { describe, it, expect } from 'vitest'
import { charForSlot } from './font-slots'

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

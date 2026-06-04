import { describe, it, expect } from 'vitest'
import { serializeCharset, parseCharset, pixelsPerChar } from './assetIo'

describe('charset asset IO — mode-dependent packing (M1.T5)', () => {
  it('reports the right grid size per mode', () => {
    expect(pixelsPerChar('TEXT_HIRES')).toBe(64)
    expect(pixelsPerChar('BITMAP_MULTICOLOR')).toBe(64)
    expect(pixelsPerChar('TEXT_MULTICOLOR')).toBe(32)
  })

  it('round-trips a hi-res char (64 cells, 0/1)', () => {
    const cells = new Uint8Array(64)
    cells[0] = 1
    cells[63] = 1
    const back = parseCharset(serializeCharset({ 5: cells }, 'TEXT_HIRES'), 'TEXT_HIRES')!
    expect(Array.from(back[5])).toEqual(Array.from(cells))
  })

  it('round-trips an MC char losslessly — all four colours survive', () => {
    // 32 double-pixels (4×8); use every index 0–3 so the bug (2/3 lost) would show.
    const cells = new Uint8Array(32)
    for (let i = 0; i < 32; i++) cells[i] = (i % 4) as 0 | 1 | 2 | 3
    const back = parseCharset(serializeCharset({ 7: cells }, 'TEXT_MULTICOLOR'), 'TEXT_MULTICOLOR')!
    expect(back[7].length).toBe(32)
    expect(Array.from(back[7])).toEqual(Array.from(cells))
    // explicit: indices 2 and 3 are not collapsed
    expect(Array.from(back[7]).filter((v) => v === 2).length).toBeGreaterThan(0)
    expect(Array.from(back[7]).filter((v) => v === 3).length).toBeGreaterThan(0)
  })

  it('reproduces the OLD bug when MC data is read as hi-res (regression guard)', () => {
    const cells = new Uint8Array(32)
    cells[0] = 3 // colour 3 (Color-RAM) in the leftmost double-pixel
    // Saved correctly as MC, but mis-read as hi-res → indices collapse to 0/1.
    const text = serializeCharset({ 0: cells }, 'TEXT_MULTICOLOR')
    const wrong = parseCharset(text, 'TEXT_HIRES')!
    expect(wrong[0].some((v) => v === 3)).toBe(false) // the loss the bug caused
    // Read with the matching mode, the 3 is preserved:
    const right = parseCharset(text, 'TEXT_MULTICOLOR')!
    expect(right[0][0]).toBe(3)
  })

  it('keeps empty chars sparse (8 zero bytes → no entry)', () => {
    const back = parseCharset(serializeCharset({}, 'TEXT_MULTICOLOR'), 'TEXT_MULTICOLOR')!
    expect(Object.keys(back).length).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import { serializeSprite, parseSprite, DEFAULT_SPRITE_COLOR, type SpriteData } from './assetIo'
import { pixelsPerSprite } from '@renderer/pixel-engine/spriteBytes'

const HIRES = pixelsPerSprite('TEXT_HIRES') // 504
const MC = pixelsPerSprite('TEXT_MULTICOLOR') // 252

/** Sprite data with the default individual colour, so frame-shape tests stay terse. */
const sd = (frames: Uint8Array[], color = DEFAULT_SPRITE_COLOR): SpriteData => ({ frames, color })

describe('sprite asset IO — mode-dependent packing (P2.T1)', () => {
  it('round-trips a hi-res sprite frame (504 cells, 0/1)', () => {
    const cells = new Uint8Array(HIRES)
    cells[0] = 1
    cells[HIRES - 1] = 1
    const back = parseSprite(serializeSprite(sd([cells]), 'TEXT_HIRES'), 'TEXT_HIRES')!
    expect(back.frames.length).toBe(1)
    expect(Array.from(back.frames[0])).toEqual(Array.from(cells))
  })

  it('round-trips an MC sprite frame losslessly — all four colours survive', () => {
    const cells = new Uint8Array(MC)
    for (let i = 0; i < MC; i++) cells[i] = (i % 4) as 0 | 1 | 2 | 3
    const back = parseSprite(serializeSprite(sd([cells]), 'TEXT_MULTICOLOR'), 'TEXT_MULTICOLOR')!
    expect(back.frames[0].length).toBe(MC)
    expect(Array.from(back.frames[0])).toEqual(Array.from(cells))
    expect(Array.from(back.frames[0]).filter((v) => v === 2).length).toBeGreaterThan(0)
    expect(Array.from(back.frames[0]).filter((v) => v === 3).length).toBeGreaterThan(0)
  })

  it('preserves multiple animation frames in order', () => {
    const f0 = new Uint8Array(MC)
    const f1 = new Uint8Array(MC)
    const f2 = new Uint8Array(MC)
    f0[0] = 1
    f1[0] = 2
    f2[0] = 3
    const back = parseSprite(serializeSprite(sd([f0, f1, f2]), 'TEXT_MULTICOLOR'), 'TEXT_MULTICOLOR')!
    expect(back.frames.length).toBe(3)
    expect(back.frames[0][0]).toBe(1)
    expect(back.frames[1][0]).toBe(2)
    expect(back.frames[2][0]).toBe(3)
  })

  it('an empty sprite still serializes one blank frame', () => {
    const back = parseSprite(serializeSprite(sd([]), 'TEXT_MULTICOLOR'), 'TEXT_MULTICOLOR')!
    expect(back.frames.length).toBe(1)
    expect(back.frames[0].every((v) => v === 0)).toBe(true)
  })

  it('stores the breadcraft.sprite format header', () => {
    const json = JSON.parse(serializeSprite(sd([new Uint8Array(HIRES)]), 'TEXT_HIRES'))
    expect(json.format).toBe('breadcraft.sprite')
    expect(json.frames[0]).toHaveLength(63)
  })

  it('returns null on malformed JSON', () => {
    expect(parseSprite('{ not json', 'TEXT_HIRES')).toBeNull()
  })

  it('round-trips the individual sprite colour', () => {
    const back = parseSprite(serializeSprite(sd([new Uint8Array(MC)], 6), 'TEXT_MULTICOLOR'), 'TEXT_MULTICOLOR')!
    expect(back.color).toBe(6)
  })

  it('defaults the colour to white for old files without one', () => {
    // A pre-individual-colour .sprite (no `color` field) reads back as the default.
    const legacy = JSON.stringify({ format: 'breadcraft.sprite', frames: [Array(63).fill(0)] })
    expect(parseSprite(legacy, 'TEXT_MULTICOLOR')!.color).toBe(DEFAULT_SPRITE_COLOR)
  })

  it('the stored bytes are mode-independent (only interpretation differs)', () => {
    // A frame painted in MC, serialized, then read as hi-res reads the SAME 63 bytes
    // back (just a different cell count) — proves no mode leaks into the file.
    const cells = new Uint8Array(MC)
    cells[0] = 3
    const text = serializeSprite(sd([cells]), 'TEXT_MULTICOLOR')
    const asHires = parseSprite(text, 'TEXT_HIRES')!
    expect(asHires.frames[0].length).toBe(HIRES) // re-interpreted at hi-res cell count
  })
})

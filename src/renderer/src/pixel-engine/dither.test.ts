import { describe, it, expect } from 'vitest'
import { BAYER4, ditherThreshold } from './dither'

describe('ordered dither (Bayer 4×4)', () => {
  it('is a permutation of 0–15 (a proper Bayer matrix)', () => {
    const flat = BAYER4.flat().slice().sort((a, b) => a - b)
    expect(flat).toEqual(Array.from({ length: 16 }, (_, i) => i))
  })

  it('produces thresholds strictly inside (0,1)', () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const t = ditherThreshold(x, y)
        expect(t).toBeGreaterThan(0)
        expect(t).toBeLessThan(1)
      }
    }
  })

  it('tiles every 4 pixels', () => {
    expect(ditherThreshold(5, 7)).toBe(ditherThreshold(1, 3))
    expect(ditherThreshold(0, 0)).toBe(ditherThreshold(8, 12))
  })

  it('wraps negative coordinates cleanly', () => {
    expect(ditherThreshold(-1, -1)).toBe(ditherThreshold(3, 3))
    expect(ditherThreshold(-4, -8)).toBe(ditherThreshold(0, 0))
  })

  it('fraction 0 is always below and 1 always above every threshold (pure endpoints)', () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const t = ditherThreshold(x, y)
        expect(0).toBeLessThanOrEqual(t) // 0 > t never true → pure `from`
        expect(1).toBeGreaterThan(t) // 1 > t always true → pure `to`
      }
    }
  })

  it('fraction 0.5 splits the 16-cell tile evenly (true checkerboard)', () => {
    let to = 0
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (0.5 > ditherThreshold(x, y)) to++
      }
    }
    expect(to).toBe(8)
  })
})

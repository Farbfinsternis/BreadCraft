import { describe, it, expect } from 'vitest'
import { planGradient, type Region } from './gradient'

const whole = (w: number, h: number): Region => ({ left: 0, top: 0, right: w - 1, bottom: h - 1 })

/** Read the planned value at (x,y) from a write list (region covers every pixel once). */
function at(writes: { x: number; y: number; value: number }[], x: number, y: number): number {
  return writes.find((wr) => wr.x === x && wr.y === y)!.value
}

describe('planGradient (line-based dithered gradient)', () => {
  it('is pure `from` at the line start and pure `to` at the line end', () => {
    const w = planGradient(whole(64, 4), 0, 0, 63, 0, 1, 3)
    for (let y = 0; y < 4; y++) {
      expect(at(w, 0, y)).toBe(1) // fraction 0 → below every threshold → from
      expect(at(w, 63, y)).toBe(3) // fraction 1 → above every threshold → to
    }
  })

  it('clamps beyond the line ends (a short line, a wide region)', () => {
    // Line only spans x 20..30, but the region is the full 0..63 width.
    const w = planGradient(whole(64, 1), 20, 0, 30, 0, 1, 3)
    expect(at(w, 0, 0)).toBe(1) // left of the line → pure from
    expect(at(w, 63, 0)).toBe(3) // right of the line → pure to
  })

  it('only ever writes the two endpoint colours', () => {
    const w = planGradient(whole(32, 8), 0, 0, 31, 7, 2, 3)
    for (const write of w) expect([2, 3]).toContain(write.value)
  })

  it('runs the gradient along the line ANGLE, independent of the region shape', () => {
    // A vertical line over a tall region → the gradient runs top→bottom, not diagonally,
    // even though the region is square. This is the whole point of decoupling the two.
    const w = planGradient(whole(8, 64), 0, 0, 0, 63, 1, 3)
    // Every column shares the same vertical progression: top row from, bottom row to.
    for (let x = 0; x < 8; x++) {
      expect(at(w, x, 0)).toBe(1)
      expect(at(w, x, 63)).toBe(3)
    }
  })

  it('only fills the given region, leaving the rest for the caller', () => {
    const w = planGradient({ left: 2, top: 1, right: 4, bottom: 1 }, 2, 1, 4, 1, 1, 3)
    expect(w).toHaveLength(3) // exactly the 3 pixels of the 1-row region
    expect(w.every((p) => p.y === 1 && p.x >= 2 && p.x <= 4)).toBe(true)
  })

  it('a zero-length line fills the region flat with `from`', () => {
    const w = planGradient(whole(4, 4), 2, 2, 2, 2, 1, 3)
    for (const write of w) expect(write.value).toBe(1)
  })
})

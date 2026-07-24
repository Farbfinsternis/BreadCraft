import { describe, it, expect } from 'vitest'
import {
  BAND_ROWS,
  LEVEL_BUDGET,
  levelBytes,
  bytesPerScreen,
  screensLeft,
  levelScreens
} from './level-budget'

// S1.B2.T3: the counter that makes a level's cost felt while painting. The numbers must
// match the engine measured on real hardware (S1 T4), not a guess — the RAM bar will
// later tell the same story, and two different stories would be worse than none.

describe('level budget', () => {
  it("counts the engine's honest map model: a byte per band cell + the tile-colour table", () => {
    expect(levelBytes(40)).toBe(40 * BAND_ROWS + 256)
  })

  it('puts one screen of level at the measured ~400 bytes', () => {
    expect(bytesPerScreen(40)).toBe(400)
  })

  it("reads a level's length in screens, one decimal", () => {
    expect(levelScreens(40, 40)).toBe(1)
    expect(levelScreens(140, 40)).toBe(3.5)
  })

  // T4: the play field's height is what a level is really paid for — a shorter band
  // stores fewer bytes per column, so the same level buys more length.
  it("charges by the play field's height, not a flat rate", () => {
    expect(levelBytes(40, 5)).toBe(40 * 5 + 256)
    expect(bytesPerScreen(40, 5)).toBe(200)
    expect(screensLeft(40, 40, 5)).toBeGreaterThan(screensLeft(40, 40, 10))
  })

  it('says how much room is left, and never promises a negative amount', () => {
    // A fresh one-screen level: nearly the whole budget is still free.
    expect(screensLeft(40, 40)).toBe(Math.floor((LEVEL_BUDGET - levelBytes(40)) / 400))
    // A level that has eaten the budget leaves nothing — not "-3 screens".
    expect(screensLeft(4000, 40)).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile } from '../index'

// The PERF estimate is a GUESS extrapolated from the code (the BASSM approach) — these
// tests pin the RELATIVE behaviour, not exact cycle counts: more/expensive work → a
// higher number, and the frame loop is what's measured.
const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)
const perf = (src: string): ReturnType<typeof compile>['perf'] => compile(src, vocab).perf

describe('perf estimate (a guess from the code)', () => {
  it('is null when there is no frame loop', () => {
    expect(perf('Global x.b = 0\nx = 1')).toBeNull()
  })

  it('estimates the frame loop (the While that runs VWait)', () => {
    const p = perf('While 1\n  VWait\nWend')
    expect(p).not.toBeNull()
    expect(p!.budgetCycles).toBeGreaterThan(0)
    expect(p!.state).toBe('ok')
  })

  it('a multiply in the frame costs more than an add (the relative signal)', () => {
    const base = 'Global a.w = 2\nGlobal b.w = 3\nGlobal x.w = 0\n'
    const add = perf(base + 'While 1\n  VWait\n  x = a + b\nWend')!
    const mul = perf(base + 'While 1\n  VWait\n  x = a * b\nWend')!
    expect(mul.cyclesPerFrame).toBeGreaterThan(add.cyclesPerFrame)
  })

  it('a For loop multiplies its body cost by the (constant) iteration count', () => {
    const one = perf('Global x.w = 0\nWhile 1\n  VWait\n  x = x + 1\nWend')!
    const loop = perf('Global x.w = 0\nWhile 1\n  VWait\n  For i = 0 To 9\n    x = x + 1\n  Next\nWend')!
    expect(loop.cyclesPerFrame).toBeGreaterThan(one.cyclesPerFrame * 5)
  })

  it('counts the cost of functions the frame calls', () => {
    const bare = perf('While 1\n  VWait\nWend')!
    const withCall = perf(
      ['Global x.w = 0', 'Function Heavy()', '  x = 1 * 2 * 3', 'EndFunction', 'While 1', '  VWait', '  Heavy', 'Wend'].join('\n')
    )!
    expect(withCall.cyclesPerFrame).toBeGreaterThan(bare.cyclesPerFrame)
  })

  it('TileSolid/TileAt (pixel→cell + hidden helper call) cost more than the inline GetTile (STAHL S10/F4)', () => {
    const solid = perf('Global p.w = 100\nWhile 1\n  VWait\n  b.b = TileSolid(p, 80)\nWend')!
    const at = perf('Global p.w = 100\nWhile 1\n  VWait\n  t.b = TileAt(p, 80)\nWend')!
    const get = perf('Global c.b = 5\nWhile 1\n  VWait\n  g.b = GetTile(c, 10)\nWend')!
    // The pixel helpers carry a 16-bit lookup + a hidden bc_tile_at call; GetTile is a
    // plain Screen-RAM index. The estimate must reflect that the workaround is cheaper.
    expect(get.cyclesPerFrame).toBeLessThan(at.cyclesPerFrame)
    expect(get.cyclesPerFrame).toBeLessThan(solid.cyclesPerFrame)
    // After F1 the solid wrapper is gone, so the two pixel helpers sit close together.
    expect(solid.cyclesPerFrame).toBeGreaterThanOrEqual(at.cyclesPerFrame)
  })

  it('flags an over-budget frame (state "over") when the work is huge', () => {
    const p = perf(
      ['Global x.w = 0', 'Global a.w = 7', 'While 1', '  VWait', '  For i = 0 To 200', '    x = a * a * a', '  Next', 'Wend'].join('\n')
    )!
    expect(p.fraction).toBeGreaterThan(1)
    expect(p.state).toBe('over')
  })
})

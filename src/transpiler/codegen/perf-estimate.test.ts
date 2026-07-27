import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile } from '../index'
import type { AssetContext } from '../index'

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

// ---- S1.B4: the scrolling engine's own cost, and the frame that would tear ----
//
// Two things make a scrolling frame different, and these tests pin both: it is not an
// AVERAGE (every 8th pixel the band physically moves a column — one heavy frame in eight),
// and it is not one BUDGET (the step must fit below the band, and what it leaves of the
// frame is what the program's own code may cost). The anchor is real hardware: at ten band
// rows the step measured 13.309 cycles of the ~14.600 the tail offers — 22 raster lines of
// air — and at twelve rows it tore (SCROLLING_PLAN T2c/T4).

/** A world wide enough to travel through: 120 columns, one colour per tile (so it buys
 *  the cheap tile→colour table), plus the mottled twin that has to pay per cell. */
function worldAssets(): AssetContext {
  const W = 120
  const charset = JSON.stringify({
    format: 'breadcraft.petscii',
    charCount: 256,
    chars: Array.from({ length: 256 }, () => [0, 0, 0, 0, 0, 0, 0, 0])
  })
  const map = (mottled: boolean): string =>
    JSON.stringify({
      format: 'breadcraft.tilemap',
      width: W,
      height: 25,
      layers: [
        {
          type: 'grafik',
          tiles: Array.from({ length: W * 25 }, () => 70),
          colors: Array.from({ length: W * 25 }, (_, i) => (mottled && i === 5 * W + 7 ? 7 : 1))
        }
      ]
    })
  const files: Record<string, string> = {
    'main.petscii': charset,
    'welt.tilemap': map(false),
    'bunt.tilemap': map(true)
  }
  return {
    manifest: {
      palette: null,
      charsets: ['main.petscii'],
      tilemaps: ['welt.tilemap', 'bunt.tilemap'],
      sprites: [],
      images: []
    },
    readFile: (rel: string) => (rel in files ? files[rel] : null)
  }
}

/** A frame loop inside a world. `band` is the PlayField, `body` the per-frame code. */
const worldPerf = (
  band: string,
  body: string,
  map = 'welt'
): ReturnType<typeof compile>['perf'] =>
  compile(
    ['UseTileset "main"', `PlayField ${band}`, `UseMap "${map}"`, 'While 1', '  VWait', body, 'Wend'].join('\n'),
    vocab,
    worldAssets()
  ).perf

describe('a scrolling frame has two walls, and one of eight is heavy (S1.B4)', () => {
  const camera = '  SetCameraX CameraX() + 1'

  it('a program without a world knows nothing of rooms (the ITD case: untouched)', () => {
    const p = compile('While 1\n  VWait\nWend', vocab).perf!
    expect(p.world).toBeUndefined()
    expect(p.fraction).toBe(p.cyclesPerFrame / p.budgetCycles)
  })

  it('the tail is what the band leaves of the frame — 8 raster lines per band row', () => {
    const p = worldPerf('3, 12', '  BorderColor BLUE')!
    expect(p.world).toBeDefined()
    expect(p.world!.bandRows).toBe(10)
    // Ten band rows draw for 80 raster lines; everything else in the frame is the tail,
    // where the band may be moved. PAL's line = 63.
    expect(p.world!.tailCycles).toBe(p.budgetCycles - 10 * 8 * 63)
  })

  it('a standing world pays nothing for a move it never makes', () => {
    const p = worldPerf('3, 12', '  BorderColor BLUE')!
    expect(p.world!.shiftCycles).toBe(0)
    expect(p.world!.everyFrames).toBe(0) // no heavy frame: all frames alike
    expect(p.state).toBe('ok')
  })

  it('a moving camera fills the tail — and that is the frame the bar shows', () => {
    const p = worldPerf('3, 12', camera)!
    expect(p.world!.everyFrames).toBe(8) // eight pixels to a character
    expect(p.world!.wall).toBe('tail')
    expect(p.fraction).toBe(p.world!.tailUsed / p.world!.tailCycles)
  })

  // S1 Schritt 2: a raster interrupt writes the two split registers, so the program no
  // longer has to be present at them — its room is the FRAME minus what moving the band
  // costs, not the band's drawing time. The lever inverts with it, and these two are the
  // hardware points the model is held to (SCROLLING_PLAN Schritt 2, T1).
  describe('the room the interrupt gave back (Schritt 2)', () => {
    it('is the frame minus the step’s share — not the band’s drawing time', () => {
      const p = worldPerf('3, 12', camera)!
      // 19.656 − 1.381 (the split's own price, measured) − 13.310/8 (the step falls on one
      // frame in eight; on the other seven the program has that time).
      expect(p.world!.roomCycles).toBe(19656 - 1381 - Math.round(13310 / 8))
      // The old model handed the program the band's drawing time (10 × 8 × 63 = 5.040)
      // and shrank it as the band got flatter. It no longer does.
      expect(p.world!.roomCycles).not.toBe(10 * 8 * 63)
    })

    it('GROWS when the play field gets flatter — the inversion the interrupt bought', () => {
      const ten = worldPerf('3, 12', camera)!
      const six = worldPerf('3, 8', camera)!
      expect(six.world!.bandRows).toBe(6)
      expect(six.world!.roomCycles).toBeGreaterThan(ten.world!.roomCycles)
      // …where the waiting technique gave a six-row band LESS (504 × 6 = 3.024 against
      // 5.040) — measured on hardware as 2.774 against 4.751.
      expect(6 * 8 * 63).toBeLessThan(10 * 8 * 63)
    })

    // ★ THE ANCHOR IS THE PORTED GAME (Schritt 2, T4). Into The Deep was built onto a
    // scrolling world three ways and each ran on real hardware with a counter on the
    // engine's own drop path. The bar has to agree with what the machine did — above all
    // in the direction that matters: what RUNS must never read "over".
    it('agrees with Into The Deep on hardware — and never cries wolf', () => {
      // ITD's own per-frame work, measured (the model's estimate of it is not the point
      // here; what is measured is which side of the wall each configuration lands on).
      const MEASURED = [
        { rows: 6, work: 11566, dropped: 0, runs: true }, //   0 of 214 frames dropped
        { rows: 6, work: 19045, dropped: 0.48, runs: false }, // 192 of 401
        { rows: 10, work: 17177, dropped: 0.86, runs: false } // 374 of 435
      ]
      for (const m of MEASURED) {
        const p = worldPerf(`3, ${m.rows + 2}`, camera)!
        expect(p.world!.bandRows).toBe(m.rows)
        const fraction = m.work / p.world!.roomCycles
        if (m.runs) {
          // Ran 214 frames without dropping one step: the bar must not call that "over".
          expect(fraction).toBeLessThan(1)
        } else {
          // Stuttered on hardware — the bar must at least be at the wall about it.
          expect(fraction).toBeGreaterThan(0.9)
        }
      }
    })
  })

  it('reproduces the measured step at ten band rows (T4: 13.309 cycles, 22 lines of air)', () => {
    const p = worldPerf('3, 12', camera)!
    // Measured on the finished engine in VICE — the model must land on it, or the bar is
    // telling a story the hardware doesn't.
    expect(p.world!.shiftCycles).toBeGreaterThan(13000)
    expect(p.world!.shiftCycles).toBeLessThan(13600)
    // 13.309 of ~14.600 = tight but standing, exactly the margin T2b measured.
    expect(p.fraction).toBeGreaterThan(0.85)
    expect(p.fraction).toBeLessThan(1)
    expect(p.state).toBe('warn')
  })

  it('DERIVES this engine\'s ten-row ceiling: at twelve rows the tail is over', () => {
    // The scissor, not a hard-coded number: work grows per band row (1.331 cycles) while
    // the room shrinks by 8 raster lines per row — so H = 12 tears where H = 10 stands,
    // which is precisely what the counter-test on real hardware showed (T2c/T4).
    const ten = worldPerf('3, 12', camera)!
    const twelve = worldPerf('3, 14', camera)!
    expect(twelve.world!.shiftCycles).toBeGreaterThan(ten.world!.shiftCycles)
    expect(twelve.world!.tailCycles).toBeLessThan(ten.world!.tailCycles)
    expect(ten.state).not.toBe('over')
    expect(twelve.state).toBe('over')
    expect(twelve.world!.wall).toBe('tail')
  })

  it('a shorter band leaves room again (the lever the user actually has)', () => {
    const six = worldPerf('3, 8', camera)!
    const ten = worldPerf('3, 12', camera)!
    expect(six.fraction).toBeLessThan(ten.fraction)
    expect(six.state).toBe('ok')
  })

  it('too much per-frame code fills the ROOM — a different wall, a different lever', () => {
    const heavy = worldPerf(
      '3, 12',
      ['  For i = 0 To 70', '    x.w = i * i * i', '  Next'].join('\n')
    )!
    // A standing world, so the tail is empty: what is full here is the program's own room
    // between two VWaits, and naming that is what lets the user fix the right thing.
    expect(heavy.world!.shiftCycles).toBe(0)
    expect(heavy.world!.wall).toBe('room')
    expect(heavy.state).toBe('over')
  })

  it('colour per TILE costs a hair more TIME than per cell — the other side of half the RAM', () => {
    const table = worldPerf('3, 12', camera, 'welt')!
    const perCell = worldPerf('3, 12', camera, 'bunt')!
    expect(table.world!.roomUsed).toBeGreaterThan(perCell.world!.roomUsed)
  })

  it('sprites cost the tail on EVERY frame (their registers go below the band)', () => {
    const none = worldPerf('3, 12', '  BorderColor BLUE')!
    const one = worldPerf('3, 12', '  Sprite 0, 100, 80')!
    expect(one.world!.tailUsed).toBeGreaterThan(none.world!.tailUsed)
    expect(one.cyclesPerFrame).toBeGreaterThan(none.cyclesPerFrame)
  })
})

describe('region picks the frame budget (STAHL S5c)', () => {
  const frame = 'While 1\n  VWait\nWend'

  it('defaults to PAL when no region is given', () => {
    expect(compile(frame, vocab).perf!.region).toBe('PAL')
  })

  it('reports the chosen region and gives NTSC a tighter budget than PAL', () => {
    const pal = compile(frame, vocab, undefined, undefined, 'PAL').perf!
    const ntsc = compile(frame, vocab, undefined, undefined, 'NTSC').perf!
    expect(pal.region).toBe('PAL')
    expect(ntsc.region).toBe('NTSC')
    // NTSC's frame is shorter → less budget → the SAME work is a bigger fraction of it.
    expect(ntsc.budgetCycles).toBeLessThan(pal.budgetCycles)
  })

  it('the same frame fills more of NTSC than of PAL (the honest reach signal)', () => {
    const work = ['Global x.w = 0', 'Global a.w = 7', 'While 1', '  VWait', '  For i = 0 To 40', '    x = a * a', '  Next', 'Wend'].join('\n')
    const pal = compile(work, vocab, undefined, undefined, 'PAL').perf!
    const ntsc = compile(work, vocab, undefined, undefined, 'NTSC').perf!
    expect(ntsc.fraction).toBeGreaterThan(pal.fraction)
  })
})

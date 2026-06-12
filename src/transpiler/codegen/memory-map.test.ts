import { describe, it, expect } from 'vitest'
import { planMemory, ramInfo } from './memory-map'

// STAHL S1a: the planner reserves only what the project uses, and emits a cfg whose
// addresses match the codegen's (one source of truth).

describe('memory-map planner (STAHL S1a)', () => {
  it('a graphics-less project keeps the full RAM (no reserved island, no cap)', () => {
    const m = planMemory({ usesCharset: false, usesSprites: false })
    expect(m.charsetAddr).toBeNull()
    expect(m.spritesAddr).toBeNull()
    // MAIN runs to HIMEM, BSS is the stock after-image region — nothing carved out.
    expect(m.cfg).toContain('MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = __HIMEM__ - __HEADER_LAST__;')
    expect(m.cfg).not.toContain('CHARSET:')
    expect(m.cfg).not.toContain('BC_CHARSET')
    expect(m.cfg).not.toContain('HIGH:')
  })

  it('a tileset reserves $3000 and caps MAIN below it; BSS moves above the bank', () => {
    const m = planMemory({ usesCharset: true, usesSprites: false })
    expect(m.charsetAddr).toBe(0x3000)
    expect(m.spritesAddr).toBeNull()
    expect(m.cfg).toContain('size = $3000 - __HEADER_LAST__;') // MAIN capped at the island
    expect(m.cfg).toContain('CHARSET:  file = %O, define = yes, start = $3000,           size = $0800;')
    expect(m.cfg).toContain('BC_CHARSET: load = CHARSET')
    expect(m.cfg).toContain('HIGH:     file = "", define = yes, start = $4000,')
    expect(m.cfg).toContain('BSS:      load = HIGH,')
    expect(m.cfg).not.toContain('SPRITES:') // sprites unused → not reserved
  })

  it('sprites-only reserves $3800 and caps MAIN there (charset stays free)', () => {
    const m = planMemory({ usesCharset: false, usesSprites: true })
    expect(m.charsetAddr).toBeNull()
    expect(m.spritesAddr).toBe(0x3800)
    expect(m.cfg).toContain('size = $3800 - __HEADER_LAST__;') // island starts at sprites
    expect(m.cfg).toContain('SPRITES:  file = %O, define = yes, start = $3800,')
    expect(m.cfg).not.toContain('CHARSET:')
  })

  it('charset + sprites reserve both; MAIN caps at the lower one ($3000)', () => {
    const m = planMemory({ usesCharset: true, usesSprites: true })
    expect(m.charsetAddr).toBe(0x3000)
    expect(m.spritesAddr).toBe(0x3800)
    expect(m.cfg).toContain('size = $3000 - __HEADER_LAST__;') // lower of the two
    expect(m.cfg).toContain('CHARSET:  file = %O, define = yes, start = $3000,')
    expect(m.cfg).toContain('SPRITES:  file = %O, define = yes, start = $3800,')
    expect(m.cfg).toContain('BC_CHARSET: load = CHARSET')
    expect(m.cfg).toContain('BC_SPRITES: load = SPRITES')
  })

  it('mainCeiling is the reserved island when graphics are used, else top of RAM', () => {
    expect(planMemory({ usesCharset: true, usesSprites: true }).mainCeiling).toBe(0x3000)
    expect(planMemory({ usesCharset: false, usesSprites: true }).mainCeiling).toBe(0x3800)
    expect(planMemory({ usesCharset: false, usesSprites: false }).mainCeiling).toBe(0xd000)
  })
})

describe('ramInfo (STAHL S1c)', () => {
  // ITD: ~5962-byte .prg against the $3000 ceiling (budget $3000-$0801 = 10239).
  it('a small tiled program is comfortably under the ceiling (ok)', () => {
    const r = ramInfo(5962, 0x3000)
    expect(r.usedBytes).toBe(5960) // drops the 2-byte load-address header
    expect(r.budgetBytes).toBe(0x3000 - 0x0801)
    expect(r.freeBytes).toBe(r.budgetBytes - r.usedBytes)
    expect(r.state).toBe('ok')
    expect(r.ceilingAddr).toBe(0x3000)
  })

  it('turns warn near the ceiling (≥ 85%)', () => {
    const budget = 0x3000 - 0x0801
    const r = ramInfo(Math.round(budget * 0.9) + 2, 0x3000)
    expect(r.state).toBe('warn')
    expect(r.fraction).toBeGreaterThanOrEqual(0.85)
    expect(r.fraction).toBeLessThan(1)
  })

  it('reports over when the image would cross the ceiling', () => {
    const budget = 0x3000 - 0x0801
    const r = ramInfo(budget + 100 + 2, 0x3000)
    expect(r.state).toBe('over')
    expect(r.freeBytes).toBeLessThan(0)
    expect(r.fraction).toBeGreaterThanOrEqual(1)
  })
})

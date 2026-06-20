import { describe, it, expect } from 'vitest'
import { planMemory, ramInfo, parseMapSegments, ramInfoFromMap } from './memory-map'

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
    // MAIN capped at the island AND filled so the charset lands at $3000 (B1.T2).
    expect(m.cfg).toContain('size = $3000 - __HEADER_LAST__, fill = yes;')
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
    // No charset → no fill (sprites are copy-based, BC_SPRITES is empty; padding would waste .prg).
    expect(m.cfg).toContain('size = $3800 - __HEADER_LAST__;') // island starts at sprites, no fill
    expect(m.cfg).not.toContain('fill = yes')
    expect(m.cfg).toContain('SPRITES:  file = %O, define = yes, start = $3800,')
    expect(m.cfg).not.toContain('CHARSET:')
  })

  it('charset + sprites reserve both; MAIN caps at the lower one ($3000)', () => {
    const m = planMemory({ usesCharset: true, usesSprites: true })
    expect(m.charsetAddr).toBe(0x3000)
    expect(m.spritesAddr).toBe(0x3800)
    expect(m.cfg).toContain('size = $3000 - __HEADER_LAST__, fill = yes;') // lower of the two, filled
    expect(m.cfg).toContain('CHARSET:  file = %O, define = yes, start = $3000,')
    expect(m.cfg).toContain('SPRITES:  file = %O, define = yes, start = $3800,')
    expect(m.cfg).toContain('BC_CHARSET: load = CHARSET')
    expect(m.cfg).toContain('BC_SPRITES: load = SPRITES')
  })

  it('exposes the bank-0 layout (bank/screen/sprite-ptr/$D018) from one plan (B1.T3)', () => {
    const m = planMemory({ usesCharset: true, usesSprites: true })
    expect(m.bank).toBe(0)
    expect(m.screenAddr).toBe(0x0400)
    expect(m.spritePtrAddr).toBe(0x07f8) // screen page + $3F8
    expect(m.d018).toBe(0x1c) // screen $0400 (bits 4-7) + charset $3000 (bits 1-3)
    // A graphics-less program still reports the bank-0 screen (defaults), no island.
    const none = planMemory({ usesCharset: false, usesSprites: false })
    expect(none.bank).toBe(0)
    expect(none.screenAddr).toBe(0x0400)
    expect(none.charsetAddr).toBeNull()
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

// B1.T1: the honest measure reads the ld65 `-m` segment map. Fixture = the real ITD
// segment list (graphics project: charset/sprites reserved, BSS high at $4000).
const ITD_MAP = `Modules list:
-------------
main.c.o:
    CODE              Offs=000000  Size=0011DE  Align=00001  Fill=0000

Segment list:
-------------
Name                   Start     End    Size  Align
----------------------------------------------------
ZEROPAGE              000002  00001B  00001A  00001
LOADADDR              0007FF  000800  000002  00001
EXEHDR                000801  00080C  00000C  00001
STARTUP               00080D  00083F  000033  00001
CODE                  000840  001A1D  0011DE  00001
RODATA                001A1E  002BAD  001190  00001
DATA                  002BAE  002C01  000054  00001
INIT                  002C02  002C1D  00001C  00001
ONCE                  002C1E  002C43  000026  00001
BSS                   004000  004019  00001A  00001


Exports list by name:
---------------------
__HEADER_LAST__           00080D RLA    __HIMEM__                 00D000 REA
`

describe('parseMapSegments / ramInfoFromMap (B1.T1)', () => {
  it('parses only the Segment list rows (absolute addresses), not other sections', () => {
    const segs = parseMapSegments(ITD_MAP)
    expect(segs.map((s) => s.name)).toEqual([
      'ZEROPAGE', 'LOADADDR', 'EXEHDR', 'STARTUP', 'CODE', 'RODATA', 'DATA', 'INIT', 'ONCE', 'BSS'
    ])
    const code = segs.find((s) => s.name === 'CODE')!
    expect(code.start).toBe(0x000840)
    expect(code.end).toBe(0x001a1d)
    expect(code.size).toBe(0x0011de)
    expect(code.end - code.start + 1).toBe(code.size) // End is the inclusive last byte
  })

  it('measures used as the top below-ceiling segment minus $0801 — matching the real ITD %', () => {
    const r = ramInfoFromMap(ITD_MAP, 0x3000)
    // ONCE ends at $2C43 → used = $2C43 - $0801 + 1 = $2443 = 9283 (the old .prg-2 figure).
    expect(r.usedBytes).toBe(0x2c43 - 0x0801 + 1)
    expect(r.usedBytes).toBe(9283)
    expect(r.budgetBytes).toBe(0x3000 - 0x0801)
    expect(r.state).toBe('warn') // 9283 / 10239 ≈ 0.907
    expect(r.fraction).toBeGreaterThanOrEqual(0.85)
  })

  it('excludes the high BSS region — it lives above the ceiling, not in the MAIN budget', () => {
    // BSS at $4000 is above the $3000 ceiling → it must not inflate the used count.
    const r = ramInfoFromMap(ITD_MAP, 0x3000)
    expect(r.usedBytes).toBe(9283) // ONCE end, NOT BSS end ($4019)
  })

  it('ignores a fixed high-loaded asset segment + its gap (the B1.T2 layout)', () => {
    // Once the charset loads directly at $3000 (no const copy), MAIN ends lower and a
    // gap opens below it. The .prg would balloon; the map measure stays honest by taking
    // the MAIN top and excluding the at-ceiling charset segment.
    const withCharset = `Segment list:
-------------
Name                   Start     End    Size  Align
----------------------------------------------------
EXEHDR                000801  00080C  00000C  00001
CODE                  00080D  001E1D  001611  00001
RODATA                001E1E  002443  000626  00001
BC_CHARSET            003000  0037FF  000800  00001
BSS                   008000  008019  00001A  00001
`
    const r = ramInfoFromMap(withCharset, 0x3000)
    expect(r.usedBytes).toBe(0x2443 - 0x0801 + 1) // RODATA top; charset ($3000) & BSS ($8000) excluded
    expect(r.usedBytes).toBeLessThan(9283) // smaller than today — the S1b win shows up
  })

  it('a graphics-less project counts low BSS toward the $D000 budget', () => {
    const noGfx = `Segment list:
-------------
Name                   Start     End    Size  Align
----------------------------------------------------
EXEHDR                000801  00080C  00000C  00001
CODE                  00080D  001000  0007F4  00001
BSS                   001001  001100  000100  00001
`
    const r = ramInfoFromMap(noGfx, 0xd000)
    // BSS is low (Start < $D000) → included; used reaches its end ($1100).
    expect(r.usedBytes).toBe(0x1100 - 0x0801 + 1)
    expect(r.ceilingAddr).toBe(0xd000)
    expect(r.state).toBe('ok')
  })

  it('handles CRLF line endings (Windows toolchain output)', () => {
    const r = ramInfoFromMap(ITD_MAP.replace(/\n/g, '\r\n'), 0x3000)
    expect(r.usedBytes).toBe(9283)
  })
})

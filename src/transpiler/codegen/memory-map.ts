import type { RamInfo } from '@shared/ipc'

// STAHL S1: the project-aware memory-map planner.
//
// From what a project ACTUALLY uses (a baked tileset? sprite shapes?), it computes ONE
// C64 memory map and emits BOTH the ld65 linker config AND the addresses the codegen
// bakes into the generated C. One source of truth — no hand-kept `#define BC_CHARSET
// 0x3000` that can drift from the linker (the two-truths class, cf. Befund 23).
//
// Reserve only what is used: a graphics-less program keeps the full RAM; a charset/
// sprite program gets its VIC island ($3000/$3800 in bank 0) carved out so code/data
// can't silently grow into it. If the program would cross the island, ld65 errors
// HONESTLY at build time instead of the game overwriting its own bytes at runtime.

// The VIC-II sees one 16KB bank at a time. EVERY derived address and register value below
// — screen, charset, sprite data/pointers, $D018, the $DD00 bank bits — comes from these
// constants, so the cfg, the C #defines and the VIC registers can't drift apart (the
// two-truths class, Befund 23).
//
// Two layouts (B1.T4): a project with a CUSTOM CHARSET moves its graphics to the TOP of
// VIC bank 1, which frees the whole low RAM + the high RAM ($8000+) for the program
// (~10KB → ~44KB). A project WITHOUT a charset (graphics-less, or sprites-only) stays in
// bank 0 with the KERNAL screen + ROM font — no bank switch, no regression. Bank 1 has no
// CHARGEN ROM shadow (unlike banks 0/2), so the charset can sit anywhere in it.
const VIC_BANK_SIZE = 0x4000 // each VIC bank is 16KB
const SPRITE_PTR_OFFSET = 0x03f8 // the 8 sprite pointers sit in the last bytes of the screen page
const SPRITE_BLOCK = 64 // a sprite shape is 64 bytes; its pointer byte = (addr − bank) / 64
const REGION_SIZE = 0x0800 // 2KB sprite island (bank-0 sprites-only reservation)
const LOAD_ADDR = 0x0801 // C64 BASIC start — every .prg loads here
const HIMEM = 0xd000 // top of usable RAM below the I/O area

// Bank-1 layout (custom charset). Graphics packed at the top so the initialized program
// image stays contiguous from $0801 up to the charset, and BSS lives above the bank.
const B1_BANK = 1
const B1_BASE = B1_BANK * VIC_BANK_SIZE // $4000
const B1_CHARSET = B1_BASE + 0x3000 // $7000 — lowest graphics, so it caps MAIN
const B1_SCREEN = B1_BASE + 0x3800 // $7800
const B1_SPRITES = B1_BASE + 0x3c00 // $7C00
const B1_BSS = 0x8000 // BSS (big arrays) above the $4000–$7FFF graphics bank

// Bank-0 layout (no custom charset). KERNAL screen + ROM font; a sprites-only program
// reserves a copy-target island just under $4000.
const B0_SCREEN = 0x0400
const B0_SPRITES = 0x3800
const B0_HIGH = 0x4000 // BSS above the bank-0 sprite island

/** The $D018 (VIC.addr) value: screen position (bits 4–7, $0400 steps) + charset position
 *  (bits 1–3, $0800 steps) WITHIN the bank. */
function d018For(screenAddr: number, charsetAddr: number, bankBase: number): number {
  return (((screenAddr - bankBase) / 0x0400) << 4) | (((charsetAddr - bankBase) / 0x0800) << 1)
}

/** The VIC.addr value for a charset program. A custom charset always uses the bank-1
 *  layout (B1.T4), so this single value is what genUseTileset emits; it equals the plan's
 *  `d018` field. Bank 1, screen $7800, charset $7000 → $EC. */
export function vicD018(): number {
  return d018For(B1_SCREEN, B1_CHARSET, B1_BASE)
}

export interface MemoryUse {
  /** A tileset is baked → graphics move to bank 1, charset copied in at runtime. */
  usesCharset: boolean
  /** Sprite shapes are baked → they need a 64-byte-aligned copy-target block. */
  usesSprites: boolean
}

export interface MemoryMap {
  /** The VIC bank the graphics live in (0 or 1). 0 = no bank switch (KERNAL defaults). */
  bank: number
  /** The CIA2 $DD00 bank-select bits (inverted: bank 1 → %10). Only poked when bank ≠ 0. */
  ciaBankBits: number
  /** Screen-RAM address (where DrawText/the tile grid write; the VIC reads it). */
  screenAddr: number
  /** The 8 sprite-pointer slots (last bytes of the screen page). */
  spritePtrAddr: number
  /** The bank-relative base block for sprite data: pointer[n] = spriteBlock0 + n. */
  spriteBlock0: number | null
  /** The $D018 / VIC.addr value placing screen + charset within the bank. */
  d018: number
  /** The charset's runtime copy-target address, or null if the project uses none. */
  charsetAddr: number | null
  /** The sprite-data block base address, or null if the project uses none. */
  spritesAddr: number | null
  /** The address the loaded program image must stay below (the RAM health-bar measures
   *  fullness against this, STAHL S1c): the charset ($7000, bank 1), the sprite island
   *  ($3800, bank 0 sprites-only), or the top of RAM ($D000, graphics-less). */
  mainCeiling: number
  /** The complete ld65 config tailored to this project (pass to cl65 via -C). */
  cfg: string
}

/** Plan the C64 memory map for a project from what it actually uses. A custom charset
 *  takes the bank-1 layout (the big-RAM move, B1.T4); otherwise bank 0. */
export function planMemory(use: MemoryUse): MemoryMap {
  return use.usesCharset ? planBank1(use) : planBank0(use)
}

/** Bank-1: graphics at the top of $4000–$7FFF, program gets the low RAM + $8000+. */
function planBank1(use: MemoryUse): MemoryMap {
  const charsetAddr = B1_CHARSET
  const spritesAddr = use.usesSprites ? B1_SPRITES : null
  return {
    bank: B1_BANK,
    ciaBankBits: B1_BANK ^ 0b11, // $DD00 bank bits are inverted: bank 1 → %10
    screenAddr: B1_SCREEN,
    spritePtrAddr: B1_SCREEN + SPRITE_PTR_OFFSET,
    spriteBlock0: spritesAddr !== null ? (spritesAddr - B1_BASE) / SPRITE_BLOCK : null,
    d018: d018For(B1_SCREEN, charsetAddr, B1_BASE),
    charsetAddr,
    spritesAddr,
    mainCeiling: charsetAddr, // the charset is the lowest graphics → MAIN stops here
    cfg: buildCfgBank1(charsetAddr)
  }
}

/** Bank-0: KERNAL screen + ROM font (no charset). Full RAM, or a sprite island. */
function planBank0(use: MemoryUse): MemoryMap {
  const spritesAddr = use.usesSprites ? B0_SPRITES : null
  return {
    bank: 0,
    ciaBankBits: 0 ^ 0b11, // bank 0 (no switch is emitted; kept for consistency)
    screenAddr: B0_SCREEN,
    spritePtrAddr: B0_SCREEN + SPRITE_PTR_OFFSET,
    spriteBlock0: spritesAddr !== null ? spritesAddr / SPRITE_BLOCK : null,
    d018: d018For(B0_SCREEN, B0_SPRITES, 0), // unused (no charset → no VIC.addr write)
    charsetAddr: null,
    spritesAddr,
    mainCeiling: spritesAddr ?? HIMEM,
    cfg: buildCfgBank0(spritesAddr)
  }
}

/** Finish a RamInfo from a used-bytes figure: budget, free, fraction, traffic-light state. */
function finishRamInfo(usedBytes: number, ceilingAddr: number): RamInfo {
  const budgetBytes = ceilingAddr - LOAD_ADDR
  const freeBytes = budgetBytes - usedBytes
  const fraction = budgetBytes > 0 ? usedBytes / budgetBytes : 1
  const state: RamInfo['state'] = fraction >= 1 ? 'over' : fraction >= 0.85 ? 'warn' : 'ok'
  return { usedBytes, budgetBytes, freeBytes, fraction, state, ceilingAddr }
}

/** Compute RAM fullness from a built .prg's size and the planned ceiling (STAHL S1c).
 *  Valid only while the .prg is a contiguous image from $0801 (its size minus the 2-byte
 *  load-address header IS the bytes used). Kept for the overflow path, where the link
 *  failed and no map file exists. The honest measure is `ramInfoFromMap` (B1.T1). */
export function ramInfo(prgSizeBytes: number, ceilingAddr: number): RamInfo {
  return finishRamInfo(Math.max(0, prgSizeBytes - 2), ceilingAddr)
}

/** One row of the ld65 `-m` map file's "Segment list" (absolute addresses). */
export interface MapSegment {
  name: string
  /** First byte address. */
  start: number
  /** Last byte address (inclusive — ld65 prints End = Start + Size - 1). */
  end: number
  /** Byte count. */
  size: number
}

/** Parse the "Segment list" section of an ld65 `-m` map file. Each row is
 *  `Name  Start  End  Size  Align` with Start/End/Size as 6-hex-digit absolute
 *  addresses; everything else (Modules list, Exports list) is ignored. */
export function parseMapSegments(mapText: string): MapSegment[] {
  const segs: MapSegment[] = []
  let inSection = false
  for (const line of mapText.split(/\r?\n/)) {
    if (line.startsWith('Segment list:')) {
      inSection = true
      continue
    }
    if (!inSection) continue
    if (/^[A-Za-z].*list:/.test(line)) break // reached the next section
    const m = /^(\w+)\s+([0-9A-Fa-f]{6})\s+([0-9A-Fa-f]{6})\s+([0-9A-Fa-f]{6})\b/.exec(line)
    if (m) {
      segs.push({
        name: m[1],
        start: parseInt(m[2], 16),
        end: parseInt(m[3], 16),
        size: parseInt(m[4], 16)
      })
    }
  }
  return segs
}

/** Honest RAM use from the ld65 map (B1.T1), measured against the planned ceiling.
 *
 *  "Used" is the top address occupied by any segment that consumes the MAIN budget —
 *  i.e. whose Start sits in [$0801, ceiling) — minus the load address. Two reasons this
 *  beats the .prg size:
 *    - it ignores padding/gaps the .prg gains once assets load at a fixed high address
 *      (B1.T2+) — the bytes between MAIN's end and the reserved island are not "used";
 *    - it counts low BSS, which occupies RAM at runtime but never appears in the file.
 *  Segments at/above the ceiling (the reserved charset/sprite island, and the high BSS
 *  region in a graphics project) are excluded — they don't compete with MAIN. */
export function ramInfoFromMap(mapText: string, ceilingAddr: number): RamInfo {
  let top = LOAD_ADDR - 1
  for (const s of parseMapSegments(mapText)) {
    if (s.size === 0) continue
    if (s.start >= LOAD_ADDR && s.start < ceilingAddr) top = Math.max(top, s.end)
  }
  return finishRamInfo(top - (LOAD_ADDR - 1), ceilingAddr)
}

function hex(n: number): string {
  return '$' + n.toString(16).toUpperCase().padStart(4, '0')
}

// The cc65 mechanics that don't vary between layouts: ZP/LOADADDR/HEADER memory, the
// segment-to-region map's fixed rows, the SYMBOLS/FEATURES boilerplate and CONDES tables.
const CFG_HEAD = [
  'MEMORY {',
  '    ZP:       file = "", define = yes, start = $0002,           size = $001A;',
  '    LOADADDR: file = %O,               start = %S - 2,          size = $0002;',
  '    HEADER:   file = %O, define = yes, start = %S,              size = $000D;'
]
const CFG_SEGMENTS_MAIN = [
  '    ZEROPAGE: load = ZP,       type = zp;',
  '    LOADADDR: load = LOADADDR, type = ro;',
  '    EXEHDR:   load = HEADER,   type = ro;',
  '    STARTUP:  load = MAIN,     type = ro;',
  '    LOWCODE:  load = MAIN,     type = ro,  optional = yes;',
  '    CODE:     load = MAIN,     type = ro;',
  '    RODATA:   load = MAIN,     type = ro;',
  '    DATA:     load = MAIN,     type = rw;',
  '    INIT:     load = MAIN,     type = rw;',
  '    ONCE:     load = MAIN,     type = ro,  define = yes;'
]
const CFG_TAIL = [
  'FEATURES {',
  '    STARTADDRESS: default = $0801;',
  '}',
  'SYMBOLS {',
  '    __LOADADDR__:  type = import;',
  '    __EXEHDR__:    type = import;',
  '    __STACKSIZE__: type = weak, value = $0800;',
  '    __HIMEM__:     type = weak, value = $D000;',
  '}',
  'FEATURES {',
  '    CONDES: type = constructor, label = __CONSTRUCTOR_TABLE__, count = __CONSTRUCTOR_COUNT__, segment = ONCE;',
  '    CONDES: type = destructor,  label = __DESTRUCTOR_TABLE__,  count = __DESTRUCTOR_COUNT__,  segment = RODATA;',
  '    CONDES: type = interruptor, label = __INTERRUPTOR_TABLE__, count = __INTERRUPTOR_COUNT__, segment = RODATA, import = __CALLIRQ__;',
  '}'
]

/** Bank-1 cfg (custom charset): all initialized segments below the graphics ($7000) in
 *  one contiguous block — no fill, so the .prg stays compact — and BSS above the bank
 *  ($8000). The charset/screen/sprites at $7000–$7FFF are runtime RAM (copied/written),
 *  not linker segments, so nothing else is placed there. */
function buildCfgBank1(charsetAddr: number): string {
  const memory = [
    ...CFG_HEAD,
    `    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = ${hex(charsetAddr)} - __HEADER_LAST__;`,
    `    HIGH:     file = "", define = yes, start = ${hex(B1_BSS)},           size = __HIMEM__ - __STACKSIZE__ - ${hex(B1_BSS)};`,
    '}'
  ]
  const segments = ['SEGMENTS {', ...CFG_SEGMENTS_MAIN, '    BSS:      load = HIGH,     type = bss, define = yes;', '}']
  return [...CFG_TAIL.slice(0, 9), ...memory, ...segments, ...CFG_TAIL.slice(9), ''].join('\n')
}

/** Bank-0 cfg (no charset): the stock-equivalent full-RAM layout, or — for a sprites-only
 *  program — MAIN capped below a reserved sprite island ($3800) with BSS above it. */
function buildCfgBank0(spritesAddr: number | null): string {
  const memory = [...CFG_HEAD]
  const segments = ['SEGMENTS {', ...CFG_SEGMENTS_MAIN]
  if (spritesAddr === null) {
    memory.push(
      '    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = __HIMEM__ - __HEADER_LAST__;',
      '    BSS:      file = "",               start = __ONCE_RUN__,    size = __HIMEM__ - __STACKSIZE__ - __ONCE_RUN__;'
    )
    segments.push('    BSS:      load = BSS,      type = bss, define = yes;')
  } else {
    memory.push(
      `    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = ${hex(spritesAddr)} - __HEADER_LAST__;`,
      `    SPRITES:  file = %O, define = yes, start = ${hex(spritesAddr)},           size = ${hex(REGION_SIZE)};`,
      `    HIGH:     file = "", define = yes, start = ${hex(B0_HIGH)},           size = __HIMEM__ - __STACKSIZE__ - ${hex(B0_HIGH)};`
    )
    segments.push('    BC_SPRITES: load = SPRITES, type = ro,  optional = yes;', '    BSS:      load = HIGH,     type = bss, define = yes;')
  }
  memory.push('}')
  segments.push('}')
  return [...CFG_TAIL.slice(0, 9), ...memory, ...segments, ...CFG_TAIL.slice(9), ''].join('\n')
}

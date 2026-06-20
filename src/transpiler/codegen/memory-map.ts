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

// The VIC graphics bank and the offsets of screen / charset / sprite data WITHIN it.
// The VIC-II sees one 16KB bank at a time; today that's bank 0, where the code also runs
// (B1.T4 will raise the bank to clear the low RAM for code). EVERY derived address and
// register value below — screen, sprite pointers, $D018 — comes from these constants, so
// the cfg, the C #defines and the VIC registers can't drift apart (the two-truths class,
// Befund 23). Bank 0 reproduces the proven _preflight layout byte-for-byte.
const VIC_BANK = 0 // VIC bank 0..3 (0 = $0000–$3FFF, where code lives today)
const VIC_BANK_SIZE = 0x4000 // each VIC bank is 16KB
const SCREEN_OFFSET = 0x0400 // screen RAM, $0400-aligned within the bank
const CHARSET_OFFSET = 0x3000 // charset, $0800-aligned (clears the $1000 CHARGEN shadow in bank 0)
const SPRITES_OFFSET = 0x3800 // 64-byte-aligned sprite-shape block above the charset
const SPRITE_PTR_OFFSET = 0x03f8 // the 8 sprite pointers sit in the last bytes of the screen page
const REGION_SIZE = 0x0800 // 2KB each (the charset needs the full slot; sprites get headroom)
const HIGH_START = 0x4000 // above the bank-0 graphics area; BSS lives here once the island
//                           is reserved, so it can't grow down into the charset/sprites.
const LOAD_ADDR = 0x0801 // C64 BASIC start — every .prg loads here
const HIMEM = 0xd000 // top of usable RAM below the I/O area (no graphics reserved → this caps)

const BANK_BASE = VIC_BANK * VIC_BANK_SIZE

/** The $D018 (VIC.addr) value for the graphics layout: the screen position (bits 4–7, in
 *  $0400 steps) and the charset position (bits 1–3, in $0800 steps) WITHIN the VIC bank.
 *  Bank 0 + screen $0400 + charset $3000 → $1C, the value proven in _preflight/tilemap.c. */
export function vicD018(): number {
  return ((SCREEN_OFFSET / 0x0400) << 4) | ((CHARSET_OFFSET / 0x0800) << 1)
}

export interface MemoryUse {
  /** A tileset is baked → charset bytes need a reserved VIC slot. */
  usesCharset: boolean
  /** Sprite shapes are baked → they need a reserved 64-byte-aligned block. */
  usesSprites: boolean
}

export interface MemoryMap {
  /** The VIC bank the graphics live in (0..3). */
  bank: number
  /** Screen-RAM address (where DrawText/the tile grid write; the VIC reads it). */
  screenAddr: number
  /** The 8 sprite-pointer slots (last bytes of the screen page). */
  spritePtrAddr: number
  /** The $D018 / VIC.addr value placing screen + charset within the bank. */
  d018: number
  /** Where the baked charset is linked, or null if the project uses none. */
  charsetAddr: number | null
  /** Where baked sprite shapes are linked, or null if the project uses none. */
  spritesAddr: number | null
  /** The address the loaded program image must stay below: the reserved VIC island
   *  ($3000/$3800) when graphics are used, else the top of RAM ($D000). The RAM
   *  health-bar measures fullness against this (STAHL S1c). */
  mainCeiling: number
  /** The complete ld65 config tailored to this project (pass to cl65 via -C). */
  cfg: string
}

/** Plan the C64 memory map for a project from what it actually uses. */
export function planMemory(use: MemoryUse): MemoryMap {
  const screenAddr = BANK_BASE + SCREEN_OFFSET
  const spritePtrAddr = screenAddr + SPRITE_PTR_OFFSET
  const charsetAddr = use.usesCharset ? BANK_BASE + CHARSET_OFFSET : null
  const spritesAddr = use.usesSprites ? BANK_BASE + SPRITES_OFFSET : null
  const reserved = [charsetAddr, spritesAddr].filter((a): a is number => a !== null)
  // The reserved VIC island starts at the lowest reserved region; MAIN must stop below it.
  const islandStart = reserved.length ? Math.min(...reserved) : null
  return {
    bank: VIC_BANK,
    screenAddr,
    spritePtrAddr,
    d018: vicD018(),
    charsetAddr,
    spritesAddr,
    mainCeiling: islandStart ?? HIMEM,
    cfg: buildCfg(charsetAddr, spritesAddr, islandStart)
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

/** Render the ld65 config. The cc65 mechanics (ZP, header, CONDES tables, stack symbols)
 *  are constant boilerplate; only the MEMORY regions + a couple of SEGMENTS vary. */
function buildCfg(charsetAddr: number | null, spritesAddr: number | null, islandStart: number | null): string {
  const memory: string[] = [
    'MEMORY {',
    '    ZP:       file = "", define = yes, start = $0002,           size = $001A;',
    '    LOADADDR: file = %O,               start = %S - 2,          size = $0002;',
    '    HEADER:   file = %O, define = yes, start = %S,              size = $000D;'
  ]
  if (islandStart === null) {
    // No graphics in bank 0 → full RAM, stock-equivalent layout.
    memory.push(
      '    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = __HIMEM__ - __HEADER_LAST__;',
      '    BSS:      file = "",               start = __ONCE_RUN__,    size = __HIMEM__ - __STACKSIZE__ - __ONCE_RUN__;'
    )
  } else {
    // Cap MAIN below the reserved VIC island; BSS goes above the bank-0 graphics area.
    // When the charset is linked straight into its region (S1b/B1.T2), MAIN must be
    // `fill`ed to its full size: ld65 writes regions to the .prg back-to-back with NO
    // address-gap padding, so without the fill the charset bytes would land right after
    // MAIN (~$2400) instead of at $3000 — garbage tiles. The fill pads the gap (the freed
    // RAM) with zeros so the load image is correct; it costs .prg size, not RAM, and that
    // padding shrinks as the program grows into the reclaimed space. Sprites stay copy-
    // based (BC_SPRITES empty) → a sprites-only program needs no fill.
    const mainFill = charsetAddr !== null ? ', fill = yes' : ''
    memory.push(
      `    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = ${hex(islandStart)} - __HEADER_LAST__${mainFill};`
    )
    if (charsetAddr !== null) memory.push(`    CHARSET:  file = %O, define = yes, start = ${hex(charsetAddr)},           size = ${hex(REGION_SIZE)};`)
    if (spritesAddr !== null) memory.push(`    SPRITES:  file = %O, define = yes, start = ${hex(spritesAddr)},           size = ${hex(REGION_SIZE)};`)
    memory.push(`    HIGH:     file = "", define = yes, start = ${hex(HIGH_START)},           size = __HIMEM__ - __STACKSIZE__ - ${hex(HIGH_START)};`)
  }
  memory.push('}')

  const segments: string[] = [
    'SEGMENTS {',
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
  // The asset segments are `optional` so an empty one (before S1b bakes data into it)
  // doesn't error. They load into the reserved regions, i.e. exactly at their address.
  if (charsetAddr !== null) segments.push('    BC_CHARSET: load = CHARSET, type = ro,  optional = yes;')
  if (spritesAddr !== null) segments.push('    BC_SPRITES: load = SPRITES, type = ro,  optional = yes;')
  segments.push(`    BSS:      load = ${islandStart === null ? 'BSS' : 'HIGH'},      type = bss, define = yes;`)
  segments.push('}')

  const boilerplate = [
    'FEATURES {',
    '    STARTADDRESS: default = $0801;',
    '}',
    'SYMBOLS {',
    '    __LOADADDR__:  type = import;',
    '    __EXEHDR__:    type = import;',
    '    __STACKSIZE__: type = weak, value = $0800;',
    '    __HIMEM__:     type = weak, value = $D000;',
    '}'
  ]
  const tables = [
    'FEATURES {',
    '    CONDES: type = constructor, label = __CONSTRUCTOR_TABLE__, count = __CONSTRUCTOR_COUNT__, segment = ONCE;',
    '    CONDES: type = destructor,  label = __DESTRUCTOR_TABLE__,  count = __DESTRUCTOR_COUNT__,  segment = RODATA;',
    '    CONDES: type = interruptor, label = __INTERRUPTOR_TABLE__, count = __INTERRUPTOR_COUNT__, segment = RODATA, import = __CALLIRQ__;',
    '}'
  ]
  return [...boilerplate, ...memory, ...segments, ...tables, ''].join('\n')
}

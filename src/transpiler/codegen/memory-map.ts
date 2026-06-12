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

const CHARSET_ADDR = 0x3000 // 2KB-aligned charset slot in VIC bank 0 (_preflight layout)
const SPRITES_ADDR = 0x3800 // 64-byte-aligned sprite-shape block above the charset
const REGION_SIZE = 0x0800 // 2KB each (the charset needs the full slot; sprites get headroom)
const HIGH_START = 0x4000 // above the bank-0 graphics area; BSS lives here once the island
//                           is reserved, so it can't grow down into the charset/sprites.
const LOAD_ADDR = 0x0801 // C64 BASIC start — every .prg loads here
const HIMEM = 0xd000 // top of usable RAM below the I/O area (no graphics reserved → this caps)

export interface MemoryUse {
  /** A tileset is baked → charset bytes need a reserved VIC slot. */
  usesCharset: boolean
  /** Sprite shapes are baked → they need a reserved 64-byte-aligned block. */
  usesSprites: boolean
}

export interface MemoryMap {
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
  const charsetAddr = use.usesCharset ? CHARSET_ADDR : null
  const spritesAddr = use.usesSprites ? SPRITES_ADDR : null
  const reserved = [charsetAddr, spritesAddr].filter((a): a is number => a !== null)
  // The reserved VIC island starts at the lowest reserved region; MAIN must stop below it.
  const islandStart = reserved.length ? Math.min(...reserved) : null
  return {
    charsetAddr,
    spritesAddr,
    mainCeiling: islandStart ?? HIMEM,
    cfg: buildCfg(charsetAddr, spritesAddr, islandStart)
  }
}

/** Compute RAM fullness from a built .prg's size and the planned ceiling (STAHL S1c).
 *  In the S1a layout the .prg is a contiguous image from $0801, so its size (minus the
 *  2-byte load-address header) IS the bytes the program occupies — no map parsing. */
export function ramInfo(prgSizeBytes: number, ceilingAddr: number): RamInfo {
  const usedBytes = Math.max(0, prgSizeBytes - 2) // drop the 2-byte load-address header
  const budgetBytes = ceilingAddr - LOAD_ADDR
  const freeBytes = budgetBytes - usedBytes
  const fraction = budgetBytes > 0 ? usedBytes / budgetBytes : 1
  const state: RamInfo['state'] = fraction >= 1 ? 'over' : fraction >= 0.85 ? 'warn' : 'ok'
  return { usedBytes, budgetBytes, freeBytes, fraction, state, ceilingAddr }
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
    memory.push(
      `    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = ${hex(islandStart)} - __HEADER_LAST__;`
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

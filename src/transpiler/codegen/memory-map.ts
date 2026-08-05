import type { RamInfo, RamPool } from '@shared/ipc'

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
const STACKSIZE = 0x0800 // cc65 C stack, reserved at the top of RAM (__STACKSIZE__)
const HIGH_CEILING = HIMEM - STACKSIZE // $C800 — top of the high BSS pool, below the stack

// Bank-1 layout (custom charset). Graphics packed at the top so the initialized program
// image stays contiguous from $0801 up to the charset, and BSS lives above the bank.
const B1_BANK = 1
const B1_BASE = B1_BANK * VIC_BANK_SIZE // $4000
const B1_CHARSET = B1_BASE + 0x3000 // $7000 — lowest graphics, so it caps MAIN
const B1_SCREEN = B1_BASE + 0x3800 // $7800
const B1_SPRITES = B1_BASE + 0x3c00 // $7C00
const B1_BSS = 0x8000 // BSS (big arrays) above the $4000–$7FFF graphics bank

// Bank-1 IMAGE layout (B2.T3). A Multicolor BITMAP can only sit at the bank's START or its
// MIDDLE — the VIC offers exactly two positions ($D018 bit 3), nothing else. We take the
// MIDDLE ($6000), so the 8000-byte matrix ends at the bank's top ($7F3F) and leaves the
// bank's lower half for the char-mode graphics a game still needs (a title picture usually
// sits in FRONT of a tile game). Consequence: charset/sprites/screen move DOWN out of the
// bitmap's way, and MAIN caps under them (~18.5KB instead of ~26KB) — the honest price of
// a picture, shown on the RAM bar.
//
// The bitmap is LINKED STRAIGHT INTO the bank (not copied from a const like the charset,
// B1.T4). At 8000 bytes a const source would cost the picture a SECOND time in low RAM
// (~10KB of ~18.5KB — half the pool, for one image). Linking it in place costs zero RAM;
// the price is .prg padding (file size only, see the GFXGAP filler below). Only the 2000
// bytes of colour data still travel as consts — Color-RAM is I/O ($D800) and can't be
// loaded into, and the screen nibbles must survive a tile game overwriting the page.
const B1_BITMAP = B1_BASE + 0x2000 // $6000 — the bank's middle; 8000 B up to $7F3F
const B1_IMG_CHARSET = B1_BASE + 0x1000 // $5000 — 2KB, $0800-aligned, clear of the bitmap
const B1_IMG_SPRITES = B1_BASE + 0x1800 // $5800 — 16 blocks up to the screen page
const B1_IMG_SCREEN = B1_BASE + 0x1c00 // $5C00 — 1000 B, $0400-aligned
/** The MC bitmap matrix: 320×200 bits = 1000 cells × 8 rows. */
const BITMAP_BYTES = 8000

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

/** The $D018 value for BITMAP mode: screen position (bits 4–7, as in text mode) + the
 *  bitmap base (bit 3 alone — 0 = bank start, 1 = bank + $2000). The charset bits 1–2 are
 *  don't-care while the VIC draws a bitmap, so one register serves both modes at different
 *  times: `UseTileset` writes the text value, `UseImage` the bitmap one. */
function d018BitmapFor(screenAddr: number, bitmapAddr: number, bankBase: number): number {
  const screenBits = ((screenAddr - bankBase) / 0x0400) << 4
  return screenBits | (bitmapAddr - bankBase === 0x2000 ? 0x08 : 0x00)
}

export interface MemoryUse {
  /** A tileset is baked → graphics move to bank 1, charset copied in at runtime. */
  usesCharset: boolean
  /** Sprite shapes are baked → they need a 64-byte-aligned copy-target block. */
  usesSprites: boolean
  /** A picture is baked (`UseImage`) → the bank makes room for the 8000-byte bitmap
   *  matrix, and everything else moves below it (B2.T3). */
  usesImage: boolean
  /** The program switches into BITMAP mode at all (`SetMode BITMAP, …`), with or without
   *  a picture. The bitmap matrix must EXIST in the bank either way: the VIC draws 8000
   *  bytes of *something*, and if the plan reserved nothing, `$D018` keeps pointing at the
   *  bank's start — which in bank 0 is the zero page, the stack and the program itself.
   *  That is the "fresh bitmap project shows garbage" bug, and it is unfixable at runtime
   *  (clearing that area would erase the running program). So a program that enters BITMAP
   *  mode takes the image layout even with nothing to show, and `SetMode` blanks the
   *  reserved matrix. Defaults to `usesImage` when omitted. */
  usesBitmap?: boolean
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
  /** How many 64-byte sprite blocks the island holds — the hard ceiling the compile-time
   *  frame-block allocator checks against (pointer-swap animation, SPRITE_ANIMATIONS.md SA1).
   *  Bank 1 (charset): 16 ($7C00–$8000); bank 0 (sprites-only): 32 ($3800 + 2KB). 0 with no
   *  sprites. Pointer-swap shares this pool across ALL sprites (one block per FRAME), so a
   *  6-frame walk cycle draws 6 blocks — an honest build error replaces a runtime corruption. */
  spriteBlocksAvail: number
  /** The $D018 / VIC.addr value placing screen + charset within the bank (TEXT mode). */
  d018: number
  /** The $D018 value placing screen + bitmap within the bank (BITMAP mode), or null if
   *  the project bakes no picture. Written by `UseImage`, where `d018` is text-mode's. */
  d018Bitmap: number | null
  /** The charset's runtime copy-target address, or null if the project uses none. */
  charsetAddr: number | null
  /** The sprite-data block base address, or null if the project uses none. */
  spritesAddr: number | null
  /** The bitmap matrix's address — the picture is LINKED here, not copied — or null if
   *  the project bakes no picture. */
  bitmapAddr: number | null
  /** The address the loaded program image must stay below (the RAM health-bar measures
   *  fullness against this, STAHL S1c): the charset ($7000, bank 1), the sprite island
   *  ($3800, bank 0 sprites-only), or the top of RAM ($D000, graphics-less). */
  mainCeiling: number
  /** Base of the SECOND RAM pool — the high BSS region for big arrays, placed above the
   *  graphics bank (bank-1 charset → $8000; bank-0 sprites-only → $4000). null when BSS
   *  is contiguous with code in the low pool (graphics-less), i.e. only one bar (B1.T5). */
  highBase: number | null
  /** Top of the high BSS pool ($C800, just below the C stack). */
  highCeiling: number
  /** The complete ld65 config tailored to this project (pass to cl65 via -C). */
  cfg: string
}

/** Plan the C64 memory map for a project from what it actually uses. BITMAP mode — with a
 *  picture or without one — takes the bank-1 IMAGE layout (the bitmap owns the bank's top
 *  half, B2.T3); a custom charset alone takes the plain bank-1 layout (the big-RAM move,
 *  B1.T4); otherwise bank 0. */
export function planMemory(use: MemoryUse): MemoryMap {
  if (use.usesImage || use.usesBitmap) return planBank1Image(use)
  return use.usesCharset ? planBank1(use) : planBank0(use)
}

/** Bank-1 with a bitmap: matrix $6000–$7F3F, everything else pushed below it. MAIN caps
 *  under the LOWEST thing the bank holds — charset, else sprites, else the screen page.
 *  A baked picture is LINKED into the matrix; without one the area is merely reserved
 *  (nothing to load, so the .prg stays compact) and `SetMode` blanks it at runtime. */
function planBank1Image(use: MemoryUse): MemoryMap {
  const charsetAddr = use.usesCharset ? B1_IMG_CHARSET : null
  const spritesAddr = use.usesSprites ? B1_IMG_SPRITES : null
  const ceiling = charsetAddr ?? spritesAddr ?? B1_IMG_SCREEN
  return {
    bank: B1_BANK,
    ciaBankBits: B1_BANK ^ 0b11,
    screenAddr: B1_IMG_SCREEN,
    spritePtrAddr: B1_IMG_SCREEN + SPRITE_PTR_OFFSET,
    spriteBlock0: spritesAddr !== null ? (spritesAddr - B1_BASE) / SPRITE_BLOCK : null,
    // The island runs from the sprite base up to the screen page ($5800–$5C00 = 16 blocks).
    spriteBlocksAvail: spritesAddr !== null ? (B1_IMG_SCREEN - B1_IMG_SPRITES) / SPRITE_BLOCK : 0,
    // Text-mode $D018 still needs a charset position even with no charset baked (the value
    // is then never written) — B1_IMG_CHARSET keeps it inside the bank.
    d018: d018For(B1_IMG_SCREEN, charsetAddr ?? B1_IMG_CHARSET, B1_BASE),
    d018Bitmap: d018BitmapFor(B1_IMG_SCREEN, B1_BITMAP, B1_BASE),
    charsetAddr,
    spritesAddr,
    bitmapAddr: B1_BITMAP,
    mainCeiling: ceiling,
    highBase: B1_BSS,
    highCeiling: HIGH_CEILING,
    cfg: buildCfgBank1Image(ceiling, !!use.usesImage)
  }
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
    // The island runs from the sprite base to the top of the bank ($8000 = B1_BSS).
    spriteBlocksAvail: spritesAddr !== null ? (B1_BSS - B1_SPRITES) / SPRITE_BLOCK : 0,
    d018: d018For(B1_SCREEN, charsetAddr, B1_BASE),
    d018Bitmap: null,
    charsetAddr,
    spritesAddr,
    bitmapAddr: null,
    mainCeiling: charsetAddr, // the charset is the lowest graphics → MAIN stops here
    highBase: B1_BSS, // big arrays live in the high pool above the $4000–$7FFF bank
    highCeiling: HIGH_CEILING,
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
    // The bank-0 sprite island is the reserved 2KB region ($3800 + REGION_SIZE).
    spriteBlocksAvail: spritesAddr !== null ? REGION_SIZE / SPRITE_BLOCK : 0,
    d018: d018For(B0_SCREEN, B0_SPRITES, 0), // unused (no charset → no VIC.addr write)
    d018Bitmap: null,
    charsetAddr: null,
    spritesAddr,
    bitmapAddr: null,
    mainCeiling: spritesAddr ?? HIMEM,
    // Sprites-only also splits RAM: MAIN caps under the $3800 island, BSS goes high ($4000).
    // Graphics-less keeps BSS contiguous with code below $D000 → one pool, no high bar.
    highBase: spritesAddr !== null ? B0_HIGH : null,
    highCeiling: HIGH_CEILING,
    cfg: buildCfgBank0(spritesAddr)
  }
}

/** Finish a RamPool from a used-bytes figure: budget, free, fraction, traffic-light state. */
function finishPool(usedBytes: number, baseAddr: number, ceilingAddr: number): RamPool {
  const budgetBytes = ceilingAddr - baseAddr
  const freeBytes = budgetBytes - usedBytes
  const fraction = budgetBytes > 0 ? usedBytes / budgetBytes : 1
  const state: RamPool['state'] = fraction >= 1 ? 'over' : fraction >= 0.85 ? 'warn' : 'ok'
  return { usedBytes, budgetBytes, freeBytes, fraction, state, baseAddr, ceilingAddr }
}

/** Compute RAM fullness from a built .prg's size and the planned ceiling (STAHL S1c).
 *  Valid only while the .prg is a contiguous image from $0801 (its size minus the 2-byte
 *  load-address header IS the bytes used). Kept for the overflow path, where the link
 *  failed and no map file exists. The honest measure is `ramInfoFromMap` (B1.T1). */
export function ramInfo(prgSizeBytes: number, ceilingAddr: number): RamInfo {
  return finishPool(Math.max(0, prgSizeBytes - 2), LOAD_ADDR, ceilingAddr)
}

/** Build an "over" RamInfo when the link FAILED with a memory-area overflow (no map exists).
 *  `area` is the ld65 area name from the error ("MAIN" = the low code/data pool, "HIGH" =
 *  the high BSS arrays pool); `over` is the byte overshoot. The bar for the pool that
 *  actually overflowed is pinned over its ceiling; the other pool is shown empty (we have
 *  no figures — the link didn't finish). Without this the overflow was always blamed on the
 *  low pool, so a HIGH overflow lit the wrong bar (B1.T5). */
export function ramInfoOverflow(
  area: string,
  over: number,
  mainCeiling: number,
  highBase: number | null,
  highCeiling: number
): RamInfo {
  if (area === 'HIGH' && highBase !== null) {
    const low = finishPool(0, LOAD_ADDR, mainCeiling)
    return { ...low, high: finishPool(highCeiling - highBase + over, highBase, highCeiling) }
  }
  const low = finishPool(mainCeiling - LOAD_ADDR + over, LOAD_ADDR, mainCeiling)
  return highBase !== null ? { ...low, high: finishPool(0, highBase, highCeiling) } : low
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

/** Honest RAM use from the ld65 map (B1.T1), measured against the planned ceiling(s).
 *
 *  "Used" is the top address occupied by any segment in a pool, minus the pool base.
 *  Two reasons this beats the .prg size:
 *    - it ignores padding/gaps the .prg gains once assets load at a fixed high address
 *      (B1.T2+) — the bytes between MAIN's end and the reserved island are not "used";
 *    - it counts BSS, which occupies RAM at runtime but never appears in the file.
 *
 *  The LOW pool is [$0801, ceiling) — code + data. When the layout splits RAM (bank-1
 *  charset, or bank-0 sprites-only), `highBase` marks a SECOND, non-fungible pool above
 *  the graphics bank where the big BSS arrays live ($8000–$C800); it's reported as
 *  `high` so the UI can give it its own bar (B1.T5). The graphics island itself (charset/
 *  sprite copy targets, between the two pools) belongs to neither and is excluded. With
 *  `highBase === null` (graphics-less) BSS sits in the low pool and there is one pool. */
export function ramInfoFromMap(
  mapText: string,
  ceilingAddr: number,
  highBase: number | null = null,
  highCeiling: number = HIGH_CEILING
): RamInfo {
  let lowTop = LOAD_ADDR - 1
  let highTop = (highBase ?? 0) - 1
  for (const s of parseMapSegments(mapText)) {
    if (s.size === 0) continue
    if (s.start >= LOAD_ADDR && s.start < ceilingAddr) lowTop = Math.max(lowTop, s.end)
    else if (highBase !== null && s.start >= highBase && s.start < highCeiling) highTop = Math.max(highTop, s.end)
  }
  const low = finishPool(lowTop - (LOAD_ADDR - 1), LOAD_ADDR, ceilingAddr)
  if (highBase === null) return low
  return { ...low, high: finishPool(highTop - (highBase - 1), highBase, highCeiling) }
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

/** Bank-1 IMAGE cfg (B2.T3): MAIN below the bank's char-mode graphics, a FILLER across
 *  them, then the bitmap linked at its fixed $6000.
 *
 *  The filler is the load-bearing bit. A .prg is ONE contiguous image from $0801, and ld65
 *  concatenates regions in FILE order WITHOUT padding address gaps — the B1.T2 lesson,
 *  where a charset silently landed ~3KB below its address. So every byte from the end of
 *  the code up to the bitmap must exist in the file: MAIN's `fill` covers its own tail, and
 *  GFXGAP covers the charset/sprite/screen area (runtime RAM, no segments of its own). Both
 *  cost file size only — never RAM.
 *
 *  WITHOUT a picture (`linked = false`) none of that applies: the program enters BITMAP mode
 *  but has nothing to load into the matrix, so the area is only RESERVED — MAIN caps under
 *  the graphics exactly the same way, but there is no BC_BITMAP segment, no filler and no
 *  fill. The .prg then ends where the code ends (a few KB instead of ~31), and `SetMode`
 *  blanks the matrix at runtime. */
function buildCfgBank1Image(ceilingAddr: number, linked: boolean): string {
  const memory = [
    ...CFG_HEAD,
    `    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = ${hex(ceilingAddr)} - __HEADER_LAST__${linked ? ', fill = yes' : ''};`
  ]
  if (linked) {
    memory.push(
      `    GFXGAP:   file = %O,               start = ${hex(ceilingAddr)},           size = ${hex(B1_BITMAP - ceilingAddr)}, fill = yes;`,
      `    BITMAP:   file = %O, define = yes, start = ${hex(B1_BITMAP)},           size = ${hex(BITMAP_BYTES)};`
    )
  }
  memory.push(
    `    HIGH:     file = "", define = yes, start = ${hex(B1_BSS)},           size = __HIMEM__ - __STACKSIZE__ - ${hex(B1_BSS)};`,
    '}'
  )
  const segments = ['SEGMENTS {', ...CFG_SEGMENTS_MAIN]
  if (linked) segments.push('    BC_BITMAP: load = BITMAP,   type = ro;')
  segments.push('    BSS:      load = HIGH,     type = bss, define = yes;', '}')
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

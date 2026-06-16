import type {
  Program,
  Statement,
  Expr,
  Pos,
  Identifier,
  CommandStmt,
  AssignStmt,
  GlobalStmt,
  ConstStmt,
  DimStmt,
  TypeDecl,
  FieldDecl,
  IndexExpr,
  FieldExpr,
  CallExpr,
  IfStmt,
  WhileStmt,
  RepeatStmt,
  ForStmt,
  FunctionDecl,
  ReturnStmt,
  CallStmt
} from '../parser/ast'
import {
  resolveCharset,
  resolveTilemap,
  resolveSprite,
  resolvePalette,
  AssetResolveError,
  type AssetManifest,
  type AssetReader,
  type ResolvedPalette
} from '../assets'
import { planMemory } from './memory-map'
import { messages, DEFAULT_LOCALE, type CodegenMessages } from '../messages'
import type { Locale } from '@shared/ipc'

/** C64 colour index (0–15) → the cc65 `COLOR_*` constant the VIC registers take.
 *  The project palette stores indices; the generated C reads as named colours. */
const COLOR_CONST: readonly string[] = [
  'COLOR_BLACK',
  'COLOR_WHITE',
  'COLOR_RED',
  'COLOR_CYAN',
  'COLOR_PURPLE',
  'COLOR_GREEN',
  'COLOR_BLUE',
  'COLOR_YELLOW',
  'COLOR_ORANGE',
  'COLOR_BROWN',
  'COLOR_LIGHTRED',
  'COLOR_GRAY1',
  'COLOR_GRAY2',
  'COLOR_LIGHTGREEN',
  'COLOR_LIGHTBLUE',
  'COLOR_GRAY3'
]

/** Map a palette colour index (0–15) to its cc65 COLOR_* constant (clamped). */
function colorConst(index: number): string {
  return COLOR_CONST[index] ?? COLOR_CONST[0]
}

// CodeGen: AST → cc65-C source. The mappings follow Sprachdef §I and the proven
// reference in _preflight/game.c (conio: bordercolor/bgcolor/clrscr/cputsxy,
// waitvsync for frame sync). Pure and non-throwing: unmapped constructs become a
// CodeGenError plus a visible /* TODO */ marker in the C, never a crash.
//
// Type system (Sprachdef §C): variables carry their type in the written suffix —
// .b → unsigned char, .w → unsigned int, $ → string. A symbol table collects each
// name's type (from the first suffix seen) so declarations are emitted with the
// right C type instead of the old "everything is unsigned int" slice. Global lives
// at file scope, Const becomes a #define. Narrowing (.w value → .b variable) is
// reported as a WARNING, never silently dropped (§C.1).
//
// Still later layers (the generator grows by adding cases, never rewriting):
// Dim/2D arrays, Records, functions, sprites/tiles, bitmap mode.

export type Severity = 'error' | 'warn'

export interface CodeGenError extends Pos {
  message: string
  severity: Severity
}

export interface CodeGenResult {
  code: string
  errors: CodeGenError[]
  /** The ld65 linker config tailored to this project's memory map (STAHL S1). The
   *  charset/sprite addresses baked into `code` come from the SAME plan, so cfg and C
   *  can't drift. Pass to cl65 via -C. */
  linkerConfig: string
  /** The address the program image must stay below (VIC island $3000/$3800 or $D000) —
   *  the ceiling the RAM health-bar measures against (STAHL S1c). */
  mainCeiling: number
}

/**
 * The compile-time asset context: how the code generator resolves an asset id
 * (`UseTileset "main"`) to its real C64 bytes. The `.bread` manifest names the
 * files; `readFile` reads one. Optional — without it, asset commands report an
 * honest "no project" error instead of crashing. See src/transpiler/assets.
 */
export interface AssetContext {
  manifest: AssetManifest
  readFile: AssetReader
}

/** A BreadCraft numeric/string type, inferred from a `.b`/`.w`/`.i`/`$` suffix.
 *  `sint` is the only SIGNED type (.i) — needed for velocities/deltas (physics). */
type VarType = 'byte' | 'word' | 'sint' | 'string'

/** The C type each BreadCraft type maps to (Sprachdef §C table). */
const C_TYPE: Record<VarType, string> = {
  byte: 'unsigned char',
  word: 'unsigned int',
  sint: 'int', // signed 16-bit (-32768..32767) — velocities, deltas, offsets
  string: 'char' // emitted as `char name[size]`; size from the assigned value (S8.T2)
}

/** Fallback string-buffer size when a string var is never sized by an assigned literal
 *  (S8.T2) — generous enough for a label, small enough to be cheap on the 6502. */
const DEFAULT_STR_CAP = 16
/** Max digits Str$ can produce (unsigned int 65535 = 5) — used to size buffers that hold
 *  a concatenation including Str$. */
const STR_NUM_MAX = 5

/** Inclusive maximum value each scalar type can hold — used by genFor to catch the
 *  unsigned-wrap traps (Befund 3). undefined = not a counting type. */
const TYPE_MAX: Record<VarType, number | undefined> = {
  byte: 255,
  word: 65535,
  sint: 32767,
  string: undefined
}

/** Human label for the counting types, for honest For-loop diagnostics. */
const TYPE_LABEL: Record<VarType, string> = {
  byte: 'Byte',
  word: 'Word',
  sint: 'Signed-Int',
  string: 'String'
}

/** Read the BreadCraft type from an identifier's written suffix. */
function suffixType(suffix: string | undefined): VarType | undefined {
  switch (suffix) {
    case '.b':
      return 'byte'
    case '.w':
      return 'word'
    case '.i':
      return 'sint'
    case '$':
      return 'string'
    default:
      return undefined
  }
}

/** The scalar (non-record) suffixes — used to tell a record suffix (.Slot) apart. */
const SCALAR_SUFFIXES = new Set(['$', '.b', '.w', '.i'])

/**
 * The record type name in a suffix like `.Slot`, or undefined for a scalar suffix
 * (`.b`/`.w`/`.i`/`$`) or none. The lexer only attaches `.Name` when Name is a known
 * record, so any `.x` that isn't a scalar suffix is a record type.
 */
function recordSuffixName(suffix: string | undefined): string | undefined {
  if (!suffix || SCALAR_SUFFIXES.has(suffix)) return undefined
  if (suffix.startsWith('.')) return suffix.slice(1)
  return undefined
}

/** BreadCraft color constant → cc65 COLOR_* macro. */
const COLOR_MACRO: Record<string, string> = {
  BLACK: 'COLOR_BLACK',
  WHITE: 'COLOR_WHITE',
  RED: 'COLOR_RED',
  CYAN: 'COLOR_CYAN',
  PURPLE: 'COLOR_PURPLE',
  GREEN: 'COLOR_GREEN',
  BLUE: 'COLOR_BLUE',
  YELLOW: 'COLOR_YELLOW',
  ORANGE: 'COLOR_ORANGE',
  BROWN: 'COLOR_BROWN',
  LIGHTRED: 'COLOR_LIGHTRED',
  GRAY1: 'COLOR_GRAY1',
  GRAY2: 'COLOR_GRAY2',
  LIGHTGREEN: 'COLOR_LIGHTGREEN',
  LIGHTBLUE: 'COLOR_LIGHTBLUE',
  GRAY3: 'COLOR_GRAY3'
}

/**
 * JoyDir enum member (as written, e.g. LEFT) → the cc65 joystick.h test macro.
 * FIRE maps to JOY_BTN_1 (the universally-available button); the rest are 1:1.
 * (The SSOT's `value` field carries JOY_FIRE, which isn't a real cc65 macro — the
 * mapping lives here, against the member name, so the generated C is valid.)
 */
const JOY_MACRO: Record<string, string> = {
  LEFT: 'JOY_LEFT',
  RIGHT: 'JOY_RIGHT',
  UP: 'JOY_UP',
  DOWN: 'JOY_DOWN',
  FIRE: 'JOY_BTN_1'
}

/** Word/symbol operator → C operator. */
const OP_C: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  mod: '%',
  '=': '==', // in expressions, BreadCraft '=' compares (assignment is a statement)
  '<>': '!=',
  '<': '<',
  '>': '>',
  '<=': '<=',
  '>=': '>=',
  and: '&&',
  or: '||',
  not: '!',
  xor: '^',
  shl: '<<',
  shr: '>>'
}

/** One entry in the symbol table: a variable's C name, type, and scope. */
interface Symbol {
  cName: string
  type: VarType
  global: boolean
  /** For a string ($) var: the C buffer size, sized from the longest value assigned
   *  to it (S8.T2). Undefined for non-strings. */
  strSize?: number
}

/**
 * A local variable or parameter inside a function body — its own scope, separate from
 * the global/main symbol table (Sprachdef §C.1: params + body locals are local). A
 * record-typed value carries its record type; a record PARAMETER is passed as a
 * const-pointer (the doctrine, breadcraft-records-in-functions) so field access uses
 * `->` and the function can't mutate the caller's record.
 */
interface LocalSym {
  cName: string
  /** Scalar type, or undefined when this is a record local/param. */
  type?: VarType
  /** Record type name when this local/param is a record. */
  recordType?: string
  /** True for a record PARAMETER (passed as `const struct X *` → field access via `->`). */
  isPointer?: boolean
  /** String ($) buffer size (S8.T2), as on Symbol. */
  strSize?: number
}

/** A user-defined function (Function…EndFunction), collected in the first pass. */
interface FuncInfo {
  cName: string
  /** Return scalar type from the name suffix, or undefined (no scalar return). */
  returnType?: VarType
  /** Record type name when the function returns a record (→ out-pointer in C). */
  returnRecord?: string
  params: { name: string; type?: VarType; recordType?: string }[]
}

/**
 * An array declared with Dim. Kept apart from scalar symbols because it has
 * dimensions (and so a different declaration + indexing path). The width (first
 * dimension) is needed for the 2D index math `zeile*breite+spalte` (Sprachdef §C).
 */
interface ArrayInfo {
  cName: string
  /** Scalar element type, OR undefined when the element is a record (see recordType). */
  type?: VarType
  /** Record type name when this is a record array (`Dim tasche.Slot[20]`). */
  recordType?: string
  /** The size expressions as written: [width] for 1D, [width, height] for 2D. */
  sizes: Expr[]
}

/** A record type (Type/Field/EndType) → its field name→type map, for field access. */
interface RecordInfo {
  cName: string
  /** Field name → its BreadCraft type (for narrowing checks + field type lookup). */
  fields: Map<string, VarType>
}

class Generator {
  private readonly errors: CodeGenError[] = []
  private readonly lines: string[] = []
  private indent = 1 // inside main()
  // The symbol table: BreadCraft name → its inferred type + scope. Built in a first
  // pass so declarations carry the right C type (Sprachdef §C). Const names are
  // tracked separately (they become #defines, not variables).
  private readonly symbols = new Map<string, Symbol>()
  private readonly arrays = new Map<string, ArrayInfo>()
  private readonly records = new Map<string, RecordInfo>()
  private readonly consts = new Map<string, Expr>()
  /** The display area set by the last `Graphics` (TEXT/BITMAP); drives requiresMode checks. */
  private gfxArea: 'TEXT' | 'BITMAP' | undefined
  /** The colour mode set by the last `Graphics` (HIRES/MULTICOLOR); UseSprite reads it
   *  to decide whether a baked sprite is multicolor (spr_mcolor bit + shared colours). */
  private gfxColor: 'HIRES' | 'MULTICOLOR' | undefined

  // ---- baked assets (UseTileset / DrawMap) ----
  /** File-scope `static const` data blocks baked from resolved assets (charset bytes,
   *  map tiles). Emitted between the arrays and main(), like Dim arrays. */
  private readonly bakedData: string[] = []
  /** True once a charset has been baked → the $D018/VIC.addr + memory-map #defines
   *  are needed in the header and a tileset is "active" for DrawMap. */
  private activeTileset: string | undefined

  // ---- tile world (M3.T1): SetTile / GetTile / TileAt / TileSolid ----
  /** Any tile-world primitive used → emit the screen memory-map + geometry defines. */
  private usesTileWorld = false
  /** GetTile(…, 1) used → bake the (currently empty) data layer BC_DATA[]. */
  private usesDataLayer = false
  /** TileAt/TileSolid used → emit the pixel→cell→tile helper (+ row*40 table). */
  private usesTileAt = false
  /** TileSolid used → emit the bc_solid[256] lookup table (solidity is a property of
   *  the TILE, STAHL S11). Separate from usesTileAt so a program using only TileAt
   *  doesn't carry the table. */
  private usesTileSolid = false
  /** The active tileset's per-slot solidity (set by UseTileset). null until a tileset
   *  is baked → bc_solid stays all-zero (nothing solid: the S11 default that makes a
   *  DrawText/HUD collision structurally impossible until the user paints walls). */
  private tilesetSolid: boolean[] | null = null

  // ---- text output (DrawText / Color) ----
  /** DrawText used → emit the bc_drawtext helper (writes C64 screen codes straight to
   *  Screen-RAM, since conio's cputsxy writes PETSCII and mis-indexes a custom charset)
   *  and require the BC_SCREEN map. */
  private usesDrawText = false
  /** DrawText or Color used → emit the bc_pen pen-colour global (the Color command's
   *  state, read by every DrawText). */
  private usesPen = false

  // ---- sprites (M3.T2): Sprite / ShowSprite / HideSprite ----
  /** Any sprite command used. Sprites poke VIC registers directly (c64.h, always
   *  included), so no extra header is needed — the flag documents the dependency. */
  private usesSprites = false
  /** UseSprite used (P2.T3) → emit the sprite-shape memory-map #defines (the 64-byte-
   *  aligned data block above the charset + the pointer slots). */
  private usesSpriteData = false

  // ---- input (M3.T3): Joystick ----
  /** Joystick() used → pull in <joystick.h> and install the driver once in main. */
  private usesJoystick = false

  // ---- math built-ins (P1.T4) ----
  /** Abs() used → pull in <stdlib.h> for cc65's abs(). (Min/Max are inline, no header.) */
  private usesStdlib = false

  // ---- strings (STAHL S8.T1) ----
  /** Str$() or a numeric DrawText arg used → emit the number→text helper (utoa into a
   *  shared scratch buffer) and pull in <stdlib.h>. One buffer, so a single Str$ per
   *  drawn line is the supported HUD case (score/lives); concatenation is S8.T2. */
  private usesStrConv = false

  // ---- string buffers (STAHL S8.T2) ----
  /** A string variable was assigned/concatenated → emit the truncating copy/append
   *  helpers (bc_scpy/bc_scat) and pull in <string.h>. */
  private usesStrBuf = false

  // ---- string functions (STAHL S8.T3) ----
  /** Len() used → needs <string.h> for strlen (but not the buffer helpers). */
  private usesStrLen = false
  /** Chr$() used → emit the single-char string helper (bc_chr). */
  private usesChr = false

  // ---- functions (P1.T3) ----
  /** All user functions, by name → signature (collected first pass). */
  private readonly functions = new Map<string, FuncInfo>()
  /** Emitted C for each function definition (before main). */
  private readonly funcDefs: string[] = []
  /** The local scope while emitting a function body (params + locals); undefined in main. */
  private localScope: Map<string, LocalSym> | undefined
  /** Name of the function currently being emitted — to forbid direct recursion. */
  private currentFunc: string | undefined
  /** Locale-bound diagnostic catalog (STAHL S5b) — every codegen error reads its text
   *  from here, so an English IDE shows English codegen errors. */
  private readonly M: CodegenMessages

  constructor(
    private readonly assets?: AssetContext,
    private readonly locale: Locale = DEFAULT_LOCALE
  ) {
    this.M = messages(locale).codegen
  }

  /** The project's shared palette colours, resolved once and cached. UseTileset +
   *  UseSprite read this so the running program's colours match the editor. With no
   *  asset context (no project) the defaults stand. A garbled .palette throws inside
   *  resolvePalette; we surface it via `at` at the resolving command's position. */
  private paletteCache: ResolvedPalette | undefined
  private palette(at: Pos): ResolvedPalette {
    if (this.paletteCache) return this.paletteCache
    if (!this.assets) {
      this.paletteCache = { kind: 'palette', background: 0, shared1: 9, shared2: 14 }
      return this.paletteCache
    }
    try {
      this.paletteCache = resolvePalette(this.assets.manifest, this.assets.readFile, this.locale)
    } catch (e) {
      this.err(e instanceof AssetResolveError ? e.message : String(e), at)
      this.paletteCache = { kind: 'palette', background: 0, shared1: 9, shared2: 14 }
    }
    return this.paletteCache
  }

  /** Where emit() writes. Defaults to main's body (this.lines); redirected to a
   *  function's buffer while a Function body is generated. */
  private sink: string[] = this.lines

  private emit(line: string): void {
    this.sink.push('  '.repeat(this.indent) + line)
  }

  private err(message: string, at: Pos, severity: Severity = 'error'): void {
    this.errors.push({ message, line: at.line, col: at.col, severity })
  }

  generate(program: Program): CodeGenResult {
    // First pass: collect declarations (types, globals, consts) so the second pass
    // can emit correctly-typed declarations and narrowing checks. Function signatures
    // are collected too (so calls can be checked/emitted before the def is reached).
    for (const s of program.body) {
      if (s.kind === 'FunctionDecl') this.collectFunction(s)
      else this.collect(s)
    }

    // Emit each function definition into its own buffer (placed before main). Done
    // before the main body so call sites see resolved signatures.
    for (const s of program.body) {
      if (s.kind === 'FunctionDecl') this.genFunction(s)
    }

    // The main body: every top-level statement that isn't a function definition.
    for (const s of program.body) {
      if (s.kind !== 'FunctionDecl') this.genStatement(s)
    }

    // Plan the C64 memory map from what this project actually bakes (STAHL S1). The
    // addresses below come from this single plan — and so does the returned linker
    // config, so the cfg's reserved regions and the C's pointers can never drift.
    const map = planMemory({
      usesCharset: !!this.activeTileset,
      usesSprites: this.usesSpriteData
    })

    const header = [
      '/* Generated by BreadCraft — do not edit by hand. */',
      '#include <conio.h>',
      '#include <c64.h>',
      '#include <cbm.h> /* waitvsync() */',
      ''
    ]
    // Tile-world memory map. Same layout proven in _preflight/tilemap.c: screen
    // $0400, our charset $3000 (free RAM above $0801). The charset pointer is only
    // needed once a tileset is baked; the screen + geometry whenever the tile-world
    // primitives (SetTile/GetTile/TileAt/TileSolid) or DrawMap touch the grid.
    if (this.activeTileset) {
      header.push(`#define BC_CHARSET ((unsigned char*)0x${map.charsetAddr!.toString(16)}) /* our tileset */`)
    }
    // BC_SCREEN is needed for the tile grid AND for DrawText (which writes screen codes
    // straight into it). The geometry defines below are only the tile-collision origin.
    if (this.activeTileset || this.usesTileWorld || this.usesDrawText) {
      header.push('#define BC_SCREEN  ((unsigned char*)0x0400) /* 40x25 screen RAM */')
    }
    if (this.activeTileset || this.usesTileWorld) {
      header.push(
        '#define BC_SCR_W   40',
        // VIC sprite coordinate origin of the top-left visible cell (the pixel→cell
        // offset, _preflight/tilecollide.c) — used by TileAt/TileSolid.
        '#define BC_SPR_X0  24',
        '#define BC_SPR_Y0  50'
      )
    }
    if (this.activeTileset || this.usesTileWorld || this.usesDrawText) {
      header.push('')
    }
    // Sprites poke VIC registers directly (c64.h, already included). The marker
    // documents that the program drives sprites and is where sprite-asset baking
    // (UseSprite) will hook in once the sprite editor/format exists.
    if (this.usesSprites) {
      header.push('/* sprites: positions/enable via VIC registers (c64.h) */', '')
    }
    // UseSprite (P2.T3) bakes shapes into a 64-byte-aligned block above the charset
    // ($3800, clear of charset $3000–$37FF + screen $0400). Slot n's shape lives at
    // BC_SPR_DATA(n) = $3800 + n*64; its pointer is BC_SPR_PTR[n] ($07F8+n) = block/64
    // = 224 + n. Proven layout: _preflight/tilecollide.c/platformer.c ($3400 area).
    if (this.usesSpriteData) {
      const spr = `0x${map.spritesAddr!.toString(16)}`
      header.push(
        `#define BC_SPR_DATA(n) ((unsigned char*)(${spr} + (unsigned int)(n) * 64))`,
        '#define BC_SPR_PTR  ((unsigned char*)0x07F8) /* sprite-pointer slots 0..7 */',
        `#define BC_SPR_BLOCK0 (${spr} / 64)          /* slot n adds n */`,
        ''
      )
    }
    // Joystick (M3.T3): the cc65 driver header. The driver itself is installed
    // once at the top of main (see the setup block) — the proven _preflight/game.c
    // pattern (joy_install + joy_read(JOY_2)).
    if (this.usesJoystick) {
      header.push('#include <joystick.h>', '')
    }
    // Math built-ins (P1.T4): cc65's abs() lives in stdlib. Min/Max are inline.
    // String conversion (S8.T1) also needs stdlib (utoa) — include it once for either.
    if (this.usesStdlib || this.usesStrConv) {
      const libs: string[] = []
      if (this.usesStdlib) libs.push('abs()/atoi()')
      if (this.usesStrConv) libs.push('utoa()')
      header.push(`#include <stdlib.h> /* ${libs.join(', ')} */`, '')
    }
    // String helpers (S8.T2/T3): truncating copy/append (strncpy/strncat) and Len (strlen).
    if (this.usesStrBuf || this.usesStrLen) {
      header.push('#include <string.h> /* strncpy/strncat/strlen for strings */', '')
    }
    // Const → #define (compile-time, free at runtime, Sprachdef §C).
    const defines: string[] = []
    for (const [name, value] of this.consts) {
      defines.push(`#define ${cName(name)} (${this.expr(value)})`)
    }
    if (defines.length > 0) defines.push('')

    // Records (Type/Field/EndType) → C structs, emitted before the arrays that use them.
    const structDecls: string[] = []
    for (const rec of this.records.values()) {
      structDecls.push(`struct ${rec.cName} {`)
      for (const [fname, ftype] of rec.fields) {
        structDecls.push(`  ${C_TYPE[ftype]} ${cName(fname)}${ftype === 'string' ? `[${DEFAULT_STR_CAP}]` : ''};`)
      }
      structDecls.push('};')
    }
    if (structDecls.length > 0) structDecls.push('')

    // Arrays (Dim) live at file scope: a level grid can be hundreds/thousands of
    // bytes, far too big for the 6502's tiny stack — static storage is the honest
    // choice (Sprachdef §C: fixed size). Emitted as a flat block; 2D is width*height.
    const arrayDecls: string[] = []
    for (const arr of this.arrays.values()) {
      const total =
        arr.sizes.length === 2
          ? `(${this.expr(arr.sizes[0])}) * (${this.expr(arr.sizes[1])})`
          : this.expr(arr.sizes[0])
      const elemType = this.arrayElemCType(arr)
      arrayDecls.push(`${elemType} ${arr.cName}[${total}];`)
    }
    if (arrayDecls.length > 0) arrayDecls.push('')

    // Globals live at file scope (before main); locals inside main.
    const globalDecls: string[] = []
    const localDecls: string[] = []
    for (const sym of this.symbols.values()) {
      const decl =
        sym.type === 'string'
          ? `char ${sym.cName}[${sym.strSize ?? DEFAULT_STR_CAP}];`
          : `${C_TYPE[sym.type]} ${sym.cName} = 0;`
      if (sym.global) globalDecls.push(decl)
      else localDecls.push('  ' + decl)
    }
    if (globalDecls.length > 0) globalDecls.push('')
    if (localDecls.length > 0) localDecls.push('')

    // Baked asset data (charset bytes, map tiles) — file scope, like Dim arrays.
    const baked = this.bakedData.length > 0 ? [...this.bakedData, ''] : []

    // Tile-world file-scope data + helpers (M3.T1), emitted only when used.
    const tileWorld = this.tileWorldDecls()

    // Number→text helper (S8.T1): one shared scratch buffer big enough for an unsigned
    // int (65535 = 5 digits + NUL). Lets DrawText show a score/lives count and backs
    // Str$(). One buffer means one conversion per drawn line — the HUD case; richer
    // composition (concatenation) waits for the $[N] buffers in S8.T2.
    const strHelpers: string[] = []
    if (this.usesStrConv) {
      strHelpers.push(
        '/* number → decimal text (shared scratch buffer; one Str$ per line) */',
        'static char bc_strbuf[6];',
        'static char* bc_str(unsigned int n) { return utoa(n, bc_strbuf, 10); }',
        ''
      )
    }
    if (this.usesChr) {
      strHelpers.push(
        '/* a single character as a 1-char string (shared scratch buffer) */',
        'static char bc_chrbuf[2];',
        'static char* bc_chr(unsigned char c) { bc_chrbuf[0] = c; bc_chrbuf[1] = 0; return bc_chrbuf; }',
        ''
      )
    }
    // Truncating copy/append into a fixed buffer (S8.T2): a too-long result is cut at
    // the buffer's capacity (cap includes the NUL), never an overflow — Sprachdef §C.
    if (this.usesStrBuf) {
      strHelpers.push(
        '/* truncating string copy/append into a fixed buffer (cap incl. the NUL) */',
        'static void bc_scpy(char* d, const char* s, unsigned int cap) { strncpy(d, s, cap - 1); d[cap - 1] = 0; }',
        'static void bc_scat(char* d, const char* s, unsigned int cap) { unsigned int n = strlen(d); if (n < cap - 1) strncat(d, s, cap - 1 - n); }',
        ''
      )
    }

    // Text output (DrawText / Color). The pen colour is a runtime global so Color sets
    // it and every DrawText reads it; the default (white, mode-folded) keeps text visible
    // even when the user never called Color.
    const textDecls: string[] = []
    if (this.usesPen) {
      textDecls.push(
        `/* pen colour for DrawText (Color sets it); ${this.gfxColor} text mode */`,
        `static unsigned char bc_pen = ${this.penCellValue('COLOR_WHITE')};`
      )
    }
    if (this.usesDrawText) {
      // Write a string as C64 SCREEN CODES straight into Screen-RAM + Colour-RAM. conio's
      // cputsxy is unusable here: it writes PETSCII, which on a custom charset indexes an
      // empty slot and shows nothing (proven in VICE 2026-06-16). The bytes we receive are
      // cc65's compile-time charmap output — uppercase letters are PETSCII *shifted* codes
      // $C1–$DA (verified in VICE: "ABC…" stored as $C1 $C2 …). Conversion to screen code:
      //   $C1–$DA (PETSCII A–Z) → 1–26;  $41–$5A (ASCII/lower-PETSCII) → 1–26;
      //   '@' ($40/$C0) → 0;  $20–$3F (space, digits from Str$, punctuation) already equal
      //   their screen code and pass through (Str$/utoa emits ASCII digits $30–$39).
      textDecls.push(
        '/* draw a string as C64 screen codes straight to Screen-RAM (see comment) */',
        'static void bc_drawtext(unsigned char x, unsigned char y, const char* s, unsigned char pen) {',
        '  unsigned int o = (unsigned int)y * 40 + x;',
        '  unsigned char c;',
        '  while ((c = (unsigned char)*s++) != 0) {',
        '    if (c >= 0xC1 && c <= 0xDA) c -= 0xC0;',
        '    else if (c >= 0x41 && c <= 0x5A) c -= 0x40;',
        '    else if (c == 0x40 || c == 0xC0) c = 0;',
        '    BC_SCREEN[o] = c;',
        '    COLOR_RAM[o] = pen;',
        '    ++o;',
        '  }',
        '}'
      )
    }
    if (textDecls.length > 0) textDecls.push('')

    // One-time setup that must run at the very top of main, before the user's body
    // (e.g. installing the joystick driver). Kept apart from this.lines so it can't
    // be reordered by the user's code. Mirrors _preflight/game.c's joy_install.
    const setup: string[] = []
    if (this.usesJoystick) {
      setup.push('  joy_install(joy_static_stddrv); /* CIA joystick driver, port 2 */')
    }
    if (setup.length > 0) setup.push('')

    // User function definitions (P1.T3) live between the globals and main, so they
    // can see file-scope globals/arrays/structs and be called from main.
    const funcs = this.funcDefs.length > 0 ? [...this.funcDefs, ''] : []

    const code = [
      ...header,
      ...defines,
      ...structDecls,
      ...arrayDecls,
      ...baked,
      ...tileWorld,
      ...strHelpers,
      ...textDecls,
      ...globalDecls,
      ...funcs,
      'int main(void) {',
      ...localDecls,
      ...setup,
      ...this.lines,
      '',
      '  return 0;',
      '}',
      ''
    ].join('\n')
    return { code, errors: this.errors, linkerConfig: map.cfg, mainCeiling: map.mainCeiling }
  }

  /**
   * File-scope declarations for the tile-world primitives (M3.T1), emitted only for
   * what the program actually uses. Mirrors _preflight/tilecollide.c:
   *   - BC_DATA[]: the invisible data layer GetTile(…,1) reads. No editor paints it
   *     yet (the META-layer is a later milestone), so it's all-zero = "nothing
   *     beneath" — the latent-object pattern stays writable and compiles today.
   *   - bc_row40[]: row → Screen-RAM offset (row*40) as a 25-entry table, so the
   *     per-pixel hot path skips the 16-bit shift chain (STAHL S10).
   *   - bc_tile_at: the pixel→cell→tile helper, so TileAt/TileSolid are plain C
   *     expressions. TileSolid folds its `!= 0` in at the call site (no wrapper).
   */
  private tileWorldDecls(): string[] {
    const out: string[] = []
    if (this.usesDataLayer) {
      out.push(
        '/* data layer (GetTile layer 1): all-zero until the META-layer milestone paints it */',
        'static unsigned char BC_DATA[40 * 25];',
        ''
      )
    }
    if (this.usesTileAt) {
      const row40 = Array.from({ length: 25 }, (_, r) => r * 40).join(', ')
      out.push(
        '/* row → Screen-RAM offset (row*40); a table beats a per-pixel 16-bit shift chain */',
        `static const unsigned int bc_row40[25] = { ${row40} };`,
        '/* pixel position → tile number at that cell (0 outside the field) */',
        'static unsigned char bc_tile_at(unsigned int px, unsigned char py) {',
        '  unsigned char col, row, ry;',
        '  if (px < BC_SPR_X0 || py < BC_SPR_Y0) return 0;',
        '  col = (unsigned char)((px - BC_SPR_X0) >> 3);',
        // py is a byte and py >= BC_SPR_Y0 is guaranteed above, so keep the row math in
        // 8 bits (byte local `ry`, compound `-=` cc65 reduces to an 8-bit sbc) instead of
        // letting C promote it to a 16-bit subtract — the per-pixel hot path (STAHL S10).
        '  ry = py;',
        '  ry -= BC_SPR_Y0;',
        '  row = ry >> 3;',
        '  if (col >= BC_SCR_W || row >= 25) return 0;',
        '  return BC_SCREEN[bc_row40[row] + col];',
        '}',
        ''
      )
    }
    if (this.usesTileSolid) {
      // Solidity is a property of the TILE (STAHL S11), not its map cell: TileSolid is
      // bc_solid[bc_tile_at(...)] — one `lda bc_solid,x` on the resolved tile number.
      // Baked from the active tileset's painted "solid" marks; all-zero when no tileset
      // (or none painted) → nothing solid, so HUD letters from DrawText never block.
      const solid = new Uint8Array(256)
      if (this.tilesetSolid) {
        for (let i = 0; i < 256 && i < this.tilesetSolid.length; i++) {
          if (this.tilesetSolid[i]) solid[i] = 1
        }
      }
      out.push(
        '/* tile → solid? (1 blocks the player); a tile property, painted in the editor */',
        'static const unsigned char bc_solid[256] = {',
        byteRows(solid),
        '};',
        ''
      )
    }
    return out
  }

  // ---- declaration collection (first pass) ----

  /**
   * Record a variable's type from its suffix. The FIRST suffix seen wins; a later
   * use without a suffix doesn't downgrade it. No suffix anywhere → byte (the cheap
   * common case, Sprachdef §C). Globals are flagged here too.
   */
  private declare(id: Identifier, opts: { global?: boolean } = {}): void {
    const name = id.name
    const type = suffixType(id.suffix)
    // Inside a function body, a plain assignment to a NEW name creates a LOCAL (unless
    // it's already a param/local, or a known global the function writes to). Sprachdef
    // §C.1: body locals live only during the call; globals are shared.
    if (this.localScope && !opts.global) {
      if (this.localScope.has(name)) {
        const l = this.localScope.get(name)!
        if (type && !l.recordType) l.type = type
        return
      }
      if (this.symbols.get(name)?.global) return // writing a known global, not a new local
      this.localScope.set(name, { cName: cName(name), type: type ?? 'byte' })
      return
    }
    const existing = this.symbols.get(name)
    if (existing) {
      if (type) existing.type = type
      if (opts.global) existing.global = true
      return
    }
    this.symbols.set(name, {
      cName: cName(name),
      type: type ?? 'byte',
      global: opts.global ?? false
    })
  }

  private collect(s: Statement): void {
    switch (s.kind) {
      case 'AssignStmt':
        // Only a scalar target declares a variable; an array element (feld[i] = …)
        // does not create a new symbol — the array was declared by Dim.
        if (s.target.kind === 'Identifier') {
          this.declare(s.target)
          this.sizeStringTarget(s.target.name, s.value)
        }
        break
      case 'GlobalStmt':
        this.declare(s.target, { global: true })
        this.sizeStringTarget(s.target.name, s.value)
        break
      case 'ConstStmt':
        this.consts.set(s.name, s.value)
        break
      case 'DimStmt': {
        const recordType = recordSuffixName(s.target.suffix)
        this.arrays.set(s.target.name, {
          cName: cName(s.target.name),
          // A record suffix (.Slot) → record array; otherwise a scalar type (byte default).
          type: recordType ? undefined : (suffixType(s.target.suffix) ?? 'byte'),
          recordType,
          sizes: s.sizes
        })
        break
      }
      case 'TypeDecl': {
        const fields = new Map<string, VarType>()
        for (const f of s.fields) fields.set(f.name, suffixType(f.suffix) ?? 'byte')
        this.records.set(s.name, { cName: cName(s.name), fields })
        break
      }
      case 'IfStmt':
        s.then.forEach((x) => this.collect(x))
        s.elifs.forEach((e) => e.body.forEach((x) => this.collect(x)))
        s.else?.forEach((x) => this.collect(x))
        break
      case 'WhileStmt':
      case 'RepeatStmt':
        s.body.forEach((x) => this.collect(x))
        break
      case 'ForStmt':
        this.declare(s.variable)
        s.body.forEach((x) => this.collect(x))
        break
      default:
        break
    }
  }

  /** Size a string variable's buffer from a value assigned to it (S8.T2). The buffer
   *  grows to fit the LONGEST thing ever assigned (+1 for the NUL); a later, longer
   *  value then truncates rather than overflows (Sprachdef §C, the user's chosen rule). */
  private sizeStringTarget(name: string, value: Expr): void {
    const sym = this.symbols.get(name)
    if (!sym || sym.type !== 'string') return
    sym.strSize = Math.max(sym.strSize ?? 0, this.estStrLen(value) + 1)
  }

  /** Estimate the longest text a string expression can produce, to size its buffer:
   *  a literal is exact, Str$ up to 5 digits, Chr$ one char, a concatenation the sum,
   *  a string var its own capacity; anything else (a number → Str$) a digit allowance. */
  private estStrLen(e: Expr): number {
    switch (e.kind) {
      case 'StringLit':
        return e.value.length
      case 'Grouping':
        return this.estStrLen(e.expr)
      case 'Binary':
        return e.op === '+' ? this.estStrLen(e.left) + this.estStrLen(e.right) : STR_NUM_MAX
      case 'CallExpr':
        return e.callee.toLowerCase() === 'chr$' ? 1 : STR_NUM_MAX
      case 'Identifier': {
        const s = this.symbols.get(e.name)
        return (s?.strSize ?? DEFAULT_STR_CAP) - 1
      }
      default:
        return STR_NUM_MAX
    }
  }

  // ---- functions (P1.T3) ----

  /** Record a function's signature in the first pass, so calls resolve before the
   *  definition is emitted. The return type comes from the name suffix (none = no
   *  return); a record suffix means a record return (→ out-pointer in C). */
  private collectFunction(s: FunctionDecl): void {
    if (this.functions.has(s.name)) {
      this.err(this.M.funcRedefined(s.name), s)
      return
    }
    const returnRecord = recordSuffixName(s.returnSuffix)
    this.functions.set(s.name, {
      cName: cName(s.name),
      returnType: returnRecord ? undefined : suffixType(s.returnSuffix),
      returnRecord,
      params: s.params.map((p) => {
        const recordType = recordSuffixName(p.suffix)
        return { name: p.name, type: recordType ? undefined : suffixType(p.suffix), recordType }
      })
    })
  }

  /** Emit a function definition into the funcDefs buffer (placed before main). Sets up
   *  a fresh local scope (params + body locals), translates the BreadCraft signature to
   *  C, and emits the body. Records: a record PARAM is a `const struct X *` (read-only,
   *  the user feels by-value — breadcraft-records-in-functions); a record RETURN becomes
   *  a trailing out-pointer and a `void` function. */
  private genFunction(s: FunctionDecl): void {
    const info = this.functions.get(s.name)
    if (!info) return // collectFunction reported a duplicate; skip the body

    // Build the local scope from the parameters.
    const scope = new Map<string, LocalSym>()
    const cParams: string[] = []
    for (const p of info.params) {
      if (p.recordType) {
        const rec = this.records.get(p.recordType)
        if (!rec) this.err(this.M.paramUnknownRecord(s.name, p.recordType, p.name), s)
        // const-pointer: read-only view, no record copy (the doctrine).
        cParams.push(`const struct ${cName(p.recordType)} *${cName(p.name)}`)
        scope.set(p.name, { cName: cName(p.name), recordType: p.recordType, isPointer: true })
      } else {
        const t = p.type ?? 'word' // typeless param → .w (reserve the wider, Sprachdef §C.1)
        cParams.push(`${C_TYPE[t]} ${cName(p.name)}`)
        scope.set(p.name, { cName: cName(p.name), type: t })
      }
    }
    // A record return is threaded as a trailing out-pointer the caller provides.
    let retC: string
    if (info.returnRecord) {
      cParams.push(`struct ${cName(info.returnRecord)} *bc_out`)
      retC = 'void'
    } else {
      retC = info.returnType ? C_TYPE[info.returnType] : 'void'
    }
    const params = cParams.length > 0 ? cParams.join(', ') : 'void'

    // Collect body locals into the scope (a mini first pass with the scope active).
    const savedScope = this.localScope
    this.localScope = scope
    this.currentFunc = s.name
    for (const st of s.body) this.collect(st)

    // Emit into the function buffer.
    const savedSink = this.sink
    const savedIndent = this.indent
    const buf: string[] = []
    this.sink = buf
    this.indent = 1
    // Local declarations (params are in the signature; only body-locals here).
    for (const [, l] of scope) {
      if (l.isPointer) continue // a param, already in the signature
      const isParam = info.params.some((p) => p.name && cName(p.name) === l.cName)
      if (isParam) continue
      if (l.recordType) this.emit(`struct ${cName(l.recordType)} ${l.cName};`)
      else if (l.type === 'string') this.emit(`char ${l.cName}[${l.strSize ?? DEFAULT_STR_CAP}];`)
      else this.emit(`${C_TYPE[l.type ?? 'byte']} ${l.cName} = 0;`)
    }
    for (const st of s.body) this.genStatement(st)

    // Assemble the function and append to funcDefs.
    this.funcDefs.push(`${retC} ${info.cName}(${params}) {`, ...buf, '}', '')

    this.sink = savedSink
    this.indent = savedIndent
    this.localScope = savedScope
    this.currentFunc = undefined
  }

  /** `Return [expr]` — in a record-returning function it fills the out-pointer; in a
   *  value function it returns the value; otherwise a bare `return;`. */
  private genReturn(s: ReturnStmt): void {
    const info = this.currentFunc ? this.functions.get(this.currentFunc) : undefined
    if (info?.returnRecord && s.value) {
      this.emit(`*bc_out = ${this.expr(s.value)};`)
      this.emit('return;')
      return
    }
    if (s.value) this.emit(`return ${this.expr(s.value)};`)
    else this.emit('return;')
  }

  /** A statement-function call `Heal 5` → `heal(5);` (no return value used). */
  private genCallStatement(s: CallStmt): void {
    const info = this.functions.get(s.callee)
    if (!info) {
      this.err(this.M.unknownFunction(s.callee), s)
      this.emit(`/* TODO: ${s.callee}(...) nicht definiert */`)
      return
    }
    if (s.callee === this.currentFunc) {
      this.err(this.M.recursion(s.callee), s)
    }
    this.emit(`${info.cName}(${this.callArgs(info, s.args)});`)
  }

  /** Render a call's argument list, passing record args by address (const-pointer
   *  contract) and scalars by value. */
  private callArgs(info: FuncInfo, args: Expr[]): string {
    return args
      .map((a, i) => {
        const p = info.params[i]
        if (p?.recordType) return `&${this.expr(a)}` // record arg → address (no copy)
        return this.expr(a)
      })
      .join(', ')
  }

  /** The inferred type of an expression, as far as the slice can tell (§D). */
  private exprType(e: Expr): VarType | undefined {
    switch (e.kind) {
      case 'StringLit':
        return 'string'
      case 'Identifier':
        return this.localScope?.get(e.name)?.type ?? this.symbols.get(e.name)?.type
      case 'IndexExpr':
        return this.arrays.get(e.name)?.type
      case 'FieldExpr':
        return this.recordOf(e.base)?.fields.get(e.field)
      case 'Grouping':
        return this.exprType(e.expr)
      case 'Binary': {
        // Widening (no implicit float, §D). SIGNED is contagious: any .i in the
        // expression makes the result signed (a velocity calc like vy + GRAVITY must
        // stay signed even if GRAVITY is written unsigned). Otherwise word > byte.
        const l = this.exprType(e.left)
        const r = this.exprType(e.right)
        if (l === 'sint' || r === 'sint') return 'sint'
        if (l === 'word' || r === 'word') return 'word'
        if (l === 'byte' || r === 'byte') return 'byte'
        return undefined
      }
      case 'CallExpr': {
        // The string-returning built-ins (S8) and any $-suffixed function yield a
        // string; that's all DrawText needs to tell "already text" from "a number to
        // convert". Other built-ins/functions fall through to their declared type.
        const n = e.callee.toLowerCase()
        if (n === 'str$' || n === 'chr$' || n === 'left$' || n === 'right$' || n === 'mid$') return 'string'
        return this.functions.get(e.callee)?.returnType
      }
      default:
        // Number literals and unknown calls: type follows the assignment target.
        return undefined
    }
  }

  /**
   * Warn when storing a value into a target that can't hold it without loss
   * (Sprachdef §C.1). Lossy pairs: word/sint → byte (range), sint → word (a negative
   * becomes a huge unsigned), word → sint (a value > 32767 flips sign). Pure widening
   * (.b → .w/.i) is silent. Unknown source types don't warn.
   */
  private checkNarrowing(target: Identifier | IndexExpr | FieldExpr, value: Expr): void {
    const tt = this.exprType(target)
    const vt = this.exprType(value)
    if (!tt || !vt) return
    let reason: string | undefined
    if (tt === 'byte' && (vt === 'word' || vt === 'sint')) {
      reason = this.M.narrowByteReason()
    } else if (tt === 'word' && vt === 'sint') {
      reason = this.M.narrowWordReason()
    } else if (tt === 'sint' && vt === 'word') {
      reason = this.M.narrowSintReason()
    }
    if (!reason) return
    const where =
      target.kind === 'Identifier'
        ? `'${target.name}'`
        : target.kind === 'IndexExpr'
          ? `'${target.name}[…]'`
          : `'\\${target.field}'`
    this.err(this.M.narrowing(where, reason), target, 'warn')
  }

  // ---- statements ----

  private genBlock(body: Statement[]): void {
    this.indent++
    for (const s of body) this.genStatement(s)
    this.indent--
  }

  private genStatement(s: Statement): void {
    switch (s.kind) {
      case 'CommandStmt':
        this.genCommand(s)
        break
      case 'AssignStmt':
        this.genAssign(s)
        break
      case 'GlobalStmt':
        // Declared at file scope; the mandatory init runs here in main (so the
        // init expression may reference earlier setup, like a normal assignment).
        this.checkNarrowing(s.target, s.value)
        // A string global is a buffer → copy into it, like any string assignment (S8.T2).
        if (this.exprType(s.target) === 'string') this.genStringAssign(s.target, s.value)
        else this.emit(`${cName(s.target.name)} = ${this.expr(s.value)};`)
        break
      case 'ConstStmt':
        // Pure compile-time → a #define in the header; nothing to emit in the body.
        break
      case 'DimStmt':
        // Declared at file scope in generate(); nothing to emit in the body.
        break
      case 'TypeDecl':
        // A struct definition emitted in generate(); nothing to emit in the body.
        break
      case 'IfStmt':
        this.genIf(s)
        break
      case 'WhileStmt':
        this.genWhile(s)
        break
      case 'RepeatStmt':
        this.genRepeat(s)
        break
      case 'ForStmt':
        this.genFor(s)
        break
      case 'ExitStmt':
        this.emit('break;')
        break
      case 'FunctionDecl':
        // Emitted separately (genFunction) before main — never inside another body.
        // Reaching here means a nested Function slipped past the parser guard; ignore.
        break
      case 'ReturnStmt':
        this.genReturn(s)
        break
      case 'CallStmt':
        this.genCallStatement(s)
        break
    }
  }

  private genCommand(s: CommandStmt): void {
    const name = s.name.toLowerCase()
    const a = s.args
    switch (name) {
      case 'graphics':
        this.genGraphics(s)
        break
      case 'vwait':
        // Frame sync (PAL 50Hz) — the proven cbm.h call (Sprachdef §F, _preflight/game.c).
        this.emit('waitvsync();')
        break
      case 'usetileset':
        this.genUseTileset(s)
        break
      case 'drawmap':
        this.genDrawMap(s)
        break
      case 'settile':
        this.genSetTile(s)
        break
      case 'sprite':
        this.genSprite(s)
        break
      case 'showsprite':
        this.genSpriteEnable(s, true)
        break
      case 'hidesprite':
        this.genSpriteEnable(s, false)
        break
      case 'usesprite':
        this.genUseSprite(s)
        break
      case 'bordercolor':
        this.emit(`bordercolor(${this.colorArg(a[0])});`)
        break
      case 'cls':
        this.emit(`bgcolor(${this.colorArg(a[0])});`)
        this.emit('clrscr();')
        break
      case 'color':
        // Color <c> → set the pen colour for following DrawText. conio's textcolor is
        // unusable here (see bc_drawtext), so the pen is our own Color-RAM value: in
        // MULTICOLOR text the cell needs bit 3 set and only 3 bits of colour (the "11"
        // pixels); in HIRES the full nibble. Persistent state (bc_pen), set at runtime.
        if (a.length >= 1) {
          this.usesPen = true
          this.emit(`bc_pen = ${this.penCellValue(this.colorArg(a[0]))};`)
        } else {
          this.err(this.M.colorArg(), s)
          this.emit('/* Color: Farbe fehlt */')
        }
        break
      case 'drawtext':
        // DrawText x, y, value → bc_drawtext writes C64 SCREEN CODES straight to Screen-
        // RAM (conio's cputsxy writes PETSCII, which mis-indexes a custom charset — the
        // letters land in empty slots and stay invisible; proven in VICE 2026-06-16). A
        // string value passes through; a NUMBER is run through Str$ first (S8.T1).
        if (a.length >= 3) {
          this.usesDrawText = true
          this.usesPen = true
          this.emit(
            `bc_drawtext(${this.expr(a[0])}, ${this.expr(a[1])}, ${this.textArg(a[2])}, bc_pen);`
          )
        } else {
          this.err(this.M.drawTextArgs(), s)
          this.emit('/* DrawText: zu wenige Argumente */')
        }
        break
      default:
        this.err(this.M.commandNoMapping(s.name), s)
        this.emit(`/* TODO: ${s.name} ${a.map((x) => this.expr(x)).join(', ')} */`)
    }
  }

  /**
   * `Graphics <area>, <colormode>` → the VIC mode bits (Sprachdef §E, _preflight/
   * tilemap.c). Phase 1: TEXT,HIRES | TEXT,MULTICOLOR | BITMAP,MULTICOLOR.
   *   - MCM (multicolor) = $D016 bit 4 (VIC.ctrl2): set for MULTICOLOR, clear for HIRES.
   *   - BMM (bitmap)     = $D011 bit 5 (VIC.ctrl1): set for BITMAP, clear for TEXT.
   * The charset pointer ($D018) belongs to UseTileset (a later layer), not here.
   */
  private genGraphics(s: CommandStmt): void {
    const area = this.constArg(s.args[0])
    // The color mode is optional and defaults to HIRES (the plain text screen, what
    // conio gives you) — so `Graphics TEXT` alone is the common UI/text case.
    const color = s.args.length >= 2 ? this.constArg(s.args[1]) : 'HIRES'
    if (area !== 'TEXT' && area !== 'BITMAP') {
      this.err(this.M.graphicsFirstArg(), s)
      return
    }
    if (color !== 'HIRES' && color !== 'MULTICOLOR') {
      this.err(this.M.graphicsSecondArg(), s)
      return
    }
    // Phase-1 forbids BITMAP,HIRES (Sprachdef §E lists only the three valid combos).
    if (area === 'BITMAP' && color === 'HIRES') {
      this.err(this.M.graphicsBitmapHires(), s)
      return
    }
    this.gfxArea = area
    this.gfxColor = color
    this.emit(`/* Graphics ${area}, ${color} */`)
    // BMM bit (bitmap vs text)
    if (area === 'BITMAP') this.emit('VIC.ctrl1 |= 0x20;')
    else this.emit('VIC.ctrl1 &= ~0x20;')
    // MCM bit (multicolor vs hires)
    if (color === 'MULTICOLOR') this.emit('VIC.ctrl2 |= 0x10;')
    else this.emit('VIC.ctrl2 &= ~0x10;')
  }

  /** Read a bare constant name (TEXT, MULTICOLOR) from an arg, upper-cased; else ''. */
  private constArg(e: Expr | undefined): string {
    return e && e.kind === 'ConstantRef' ? e.name.toUpperCase() : ''
  }

  /** Read a string-literal arg (an asset id like "main"); undefined if not a string. */
  private stringArg(e: Expr | undefined): string | undefined {
    return e && e.kind === 'StringLit' ? e.value : undefined
  }

  /** A value being drawn as text (S8.T1): a string expression passes through; anything
   *  else is treated as a number and wrapped in Str$ (bc_str) so bc_drawtext gets a char*. */
  private textArg(e: Expr): string {
    if (this.exprType(e) === 'string') return this.expr(e)
    this.usesStrConv = true
    return `bc_str(${this.expr(e)})`
  }

  /** A colour as the Color-RAM byte for the current text mode. In MULTICOLOR text a cell
   *  is only drawn multicolor when bit 3 is set, and just the low 3 bits choose the "11"
   *  pixel colour; in HIRES text the full nibble is the foreground. So the pen folds the
   *  mode in here, once, where gfxColor is known. */
  private penCellValue(colorExpr: string): string {
    return this.gfxColor === 'MULTICOLOR' ? `((${colorExpr}) & 7) | 8` : `(${colorExpr})`
  }

  /** Report a missing argument for a string function (S8.T3) and yield a safe 0/"". */
  private stringFnArgErr(e: CallExpr): string {
    this.err(this.M.stringFnArg(e.callee), e)
    return `/* ${e.callee}: Argument fehlt */ 0`
  }

  /**
   * `UseTileset "id"` → bake the painted charset bytes into C, point the VIC at our
   * charset ($3000) + screen ($0400), and set the MC-text shared colours. The proven
   * pattern is _preflight/tilemap.c (Z.32/50/88–95). This is the $D018 piece that
   * `Graphics` deliberately left out. Without an asset context (no project), an honest
   * error — the bytes can't be resolved.
   */
  private genUseTileset(s: CommandStmt): void {
    const id = this.stringArg(s.args[0])
    if (!id) {
      this.err(this.M.useTilesetName(), s)
      return
    }
    if (!this.assets) {
      this.err(this.M.useTilesetNoProject(id), s)
      return
    }
    let bytes: Uint8Array
    try {
      const resolved = resolveCharset(id, this.assets.manifest, this.assets.readFile, this.locale)
      bytes = resolved.bytes
      // Remember which slots are solid so TileSolid can bake a bc_solid[256] table
      // (solidity travels with the charset, STAHL S11). Last UseTileset wins, mirroring
      // activeTileset — Phase 1 uses one charset.
      this.tilesetSolid = resolved.solid
    } catch (e) {
      this.err(e instanceof AssetResolveError ? e.message : String(e), s)
      return
    }

    const dataName = `tileset_${safeAssetName(id)}`
    this.bakedData.push(
      `static const unsigned char ${dataName}[${bytes.length}] = {`,
      byteRows(bytes),
      '};'
    )
    this.activeTileset = id

    this.emit(`/* UseTileset "${id}" */`)
    this.emit(`{ unsigned int _i; for (_i = 0; _i < ${bytes.length}; ++_i) BC_CHARSET[_i] = ${dataName}[_i]; }`)
    // Point VIC at screen $0400 + charset $3000 (VIC.addr = 0x1C), proven in tilemap.c.
    this.emit('VIC.addr = 0x1C;')
    // MC-text shared colours from the project palette (the "00/01/10" pairs; the
    // "11" pair is per-cell Color-RAM). Same registers the sprites share — one
    // project-wide truth (memory breadcraft-project-palette).
    const pal = this.palette(s)
    this.emit(`VIC.bgcolor[0] = ${colorConst(pal.background)};`)
    this.emit(`VIC.bgcolor[1] = ${colorConst(pal.shared1)};`)
    this.emit(`VIC.bgcolor[2] = ${colorConst(pal.shared2)};`)
  }

  /**
   * `DrawMap "id"` → bake the painted 40×25 tile numbers and copy them into screen
   * RAM, so the VIC draws the map for free (proven _preflight/tilemap.c Z.103–119).
   * Needs an active tileset (the chars to draw) — otherwise an honest error.
   */
  private genDrawMap(s: CommandStmt): void {
    const id = this.stringArg(s.args[0])
    if (!id) {
      this.err(this.M.drawMapName(), s)
      return
    }
    if (!this.assets) {
      this.err(this.M.drawMapNoProject(id), s)
      return
    }
    if (!this.activeTileset) {
      this.err(this.M.drawMapNoTileset(id), s)
      return
    }
    let tiles: Uint8Array
    let colors: Uint8Array
    try {
      const map = resolveTilemap(id, this.assets.manifest, this.assets.readFile, this.locale)
      tiles = map.tiles
      colors = map.colors
    } catch (e) {
      this.err(e instanceof AssetResolveError ? e.message : String(e), s)
      return
    }

    const cName = `map_${safeAssetName(id)}`
    const colName = `mapcol_${safeAssetName(id)}`
    this.bakedData.push(
      `static const unsigned char ${cName}[${tiles.length}] = {`,
      byteRows(tiles),
      '};'
    )
    // Bake the per-cell Color-RAM colours with bit 3 set (multicolor in MC-text) right
    // in the table, so the copy loop is a plain memcpy — the colour the editor painted
    // per 8×8 cell reaches the VIC (no longer a fixed grey).
    this.bakedData.push(
      `static const unsigned char ${colName}[${colors.length}] = {`,
      byteRows(colors.map((c) => (c & 0x0f) | 8)),
      '};'
    )

    this.emit(`/* DrawMap "${id}" */`)
    // Copy tile numbers to screen RAM and the painted per-cell colours to Color-RAM.
    this.emit(
      `{ unsigned int _c; for (_c = 0; _c < ${tiles.length}; ++_c) { BC_SCREEN[_c] = ${cName}[_c]; COLOR_RAM[_c] = ${colName}[_c]; } }`
    )
  }

  /**
   * `SetTile col, row, tile, color` → poke one cell: the tile number into Screen-RAM
   * and the colour into Color-RAM at offset row*40+col (Sprachdef §E, the proven
   * single-cell write of _preflight/sokoban_push.c). Multicolor-text needs bit 3 set
   * in Color-RAM (| 8) for the cell to read as multicolor.
   */
  private genSetTile(s: CommandStmt): void {
    const a = s.args
    if (a.length < 4) {
      this.err(this.M.setTileArgs(), s)
      this.emit('/* SetTile: zu wenige Argumente */')
      return
    }
    this.usesTileWorld = true
    const col = this.expr(a[0])
    const row = this.expr(a[1])
    const tile = this.expr(a[2])
    const color = this.colorArg(a[3])
    // Strength-reduce row×40 to shifts when the row is a plain variable (safe to read
    // twice); a literal/complex row stays a `* BC_SCR_W` (cc65 folds constants anyway).
    const off = `${this.screenRowOffset(row, a[1].kind === 'Identifier')} + (${col})`
    this.emit(`BC_SCREEN[${off}] = ${tile};`)
    this.emit(`COLOR_RAM[${off}] = (${color}) | 8;`)
  }

  /**
   * `Sprite n, x, y` → position sprite n in pixel coordinates (proven _preflight/
   * sprite.c). Two pieces of C64 hardware reality the command TRANSLATES for the
   * user (it makes the bookkeeping convenient — it does NOT hide a cost; the doctrine
   * is "take away the crypticness, not the cost", breadcraft-translation-doctrine):
   *   - X is 0–319 but each sprite's X register is 8 bits; the 9th bit lives in
   *     VIC.spr_hi_x bit n, so we split it: low byte to spr_pos[n].x, carry to the
   *     mask bit. y is plain 8-bit → spr_pos[n].y.
   *   - cc65's VIC.spr_pos[8] array (c64.h cc65 mode) lets n be any expression.
   * `Sprite n, OFF` is the overloaded off-variant (SSOT): the 2nd arg is the
   * SpriteState constant OFF → just disable the sprite (same as HideSprite n).
   *
   * `n` is a VIRTUAL sprite id (Sprachdef "Sprite-IDs", STAHL S3), not inherently a
   * hardware slot — today it maps 1:1 onto VIC slot n (this direct emit), but a future
   * multiplexer will own the 8 physical slots and remap, with the user's id unchanged.
   * Emit stays slot n; the indirection is the contract, not a code layer (yet).
   */
  private genSprite(s: CommandStmt): void {
    const a = s.args
    // Off-variant: `Sprite n, OFF` — 2nd arg is the OFF constant, not an x value.
    if (a.length === 2 && a[1].kind === 'ConstantRef' && a[1].name.toUpperCase() === 'OFF') {
      this.emitSpriteEnable(this.expr(a[0]), false)
      return
    }
    if (a.length < 3) {
      this.err(this.M.spriteArgs(), s)
      this.emit('/* Sprite: zu wenige Argumente */')
      return
    }
    this.usesSprites = true
    const n = this.expr(a[0])
    const x = this.expr(a[1])
    const y = this.expr(a[2])
    // Position; the 9th X bit (X >= 256) is carried into spr_hi_x bit n by hand.
    this.emit(`VIC.spr_pos[${n}].x = (unsigned char)((${x}) & 0xFF);`)
    this.emit(`if ((${x}) & 0x100) VIC.spr_hi_x |= (1 << (${n})); else VIC.spr_hi_x &= ~(1 << (${n}));`)
    this.emit(`VIC.spr_pos[${n}].y = (${y});`)
  }

  /** `ShowSprite n` / `HideSprite n` → flip the sprite's enable bit (VIC.spr_ena). */
  private genSpriteEnable(s: CommandStmt, on: boolean): void {
    const a = s.args
    if (a.length < 1) {
      this.err(this.M.spriteNumberRange(s.name), s)
      this.emit(`/* ${s.name}: fehlende Sprite-Nummer */`)
      return
    }
    this.emitSpriteEnable(this.expr(a[0]), on)
  }

  /** Emit the enable-bit poke for sprite n (shared by ShowSprite/HideSprite/Sprite n,OFF). */
  private emitSpriteEnable(n: string, on: boolean): void {
    this.usesSprites = true
    if (on) this.emit(`VIC.spr_ena |= (1 << (${n}));`)
    else this.emit(`VIC.spr_ena &= ~(1 << (${n}));`)
  }

  /**
   * `UseSprite slot, "name"` → bake a painted sprite's shape (frame 0) into the
   * program and hand it to hardware slot `slot` (0–7): copy the 63 shape bytes into
   * that slot's 64-byte-aligned block (BC_SPR_DATA(slot) = $3800 + slot*64) and point
   * the slot's pointer ($07F8+slot) at it. Proven pattern: _preflight/sprite.c (hi-
   * res) + sprite_mc.c (multicolor). The slot is the same number Sprite/ShowSprite
   * use — UseSprite gives the shape, those give position/enable.
   *
   * The slot is the user's own number (named-variable style, breadcraft-translation-
   * doctrine TEIL F): readable, and we check it's a compile-time constant 0–7 where we
   * can — a clear error beats cryptic cc65/HW frustration. A variable slot is allowed
   * (the shape RAM math is runtime-safe), but then we can't pre-warn on out-of-range.
   *
   * Colours: multicolor (from the project Graphics mode) sets the slot's MC bit +
   * the two SHARED registers (spr_mcolor0/1 = the project palette's shared pair, the
   * same coupling UseTileset uses). The INDIVIDUAL per-sprite colour (spr_color[slot])
   * has no per-sprite storage yet → a sensible default (white); a real per-sprite
   * colour is a later editor feature.
   */
  private genUseSprite(s: CommandStmt): void {
    const a = s.args
    if (a.length < 2) {
      this.err(this.M.useSpriteArgs(), s)
      return
    }
    const id = this.stringArg(a[1])
    if (!id) {
      this.err(this.M.useSpriteSecondArg(), s)
      return
    }
    if (!this.assets) {
      this.err(this.M.useSpriteNoProject(id), s)
      return
    }
    // A constant slot we can range-check now (the doctrine: translate the error, don't
    // hide it). A variable/expression slot is allowed but can't be pre-checked.
    if (a[0].kind === 'NumberLit') {
      const slotNum = Number(a[0].raw)
      if (!Number.isInteger(slotNum) || slotNum < 0 || slotNum > 7) {
        this.err(this.M.useSpriteSlotRange(slotNum), s)
        return
      }
    }

    let frames: Uint8Array[]
    let spriteColor: number
    try {
      const resolved = resolveSprite(id, this.assets.manifest, this.assets.readFile, this.locale)
      frames = resolved.frames
      spriteColor = resolved.color
    } catch (e) {
      this.err(e instanceof AssetResolveError ? e.message : String(e), s)
      return
    }
    const frame0 = frames[0] // resolveSprite guarantees ≥1 frame of 63 bytes

    this.usesSprites = true
    this.usesSpriteData = true
    const slot = this.expr(a[0])
    const dataName = `sprite_${safeAssetName(id)}`
    this.bakedData.push(
      `static const unsigned char ${dataName}[${frame0.length}] = {`,
      byteRows(frame0),
      '};'
    )

    this.emit(`/* UseSprite ${slot}, "${id}" */`)
    // Copy the 63 shape bytes into this slot's sprite-data block, then point the slot.
    this.emit(
      `{ unsigned char _s; unsigned char* _d = BC_SPR_DATA(${slot}); ` +
        `for (_s = 0; _s < ${frame0.length}; ++_s) _d[_s] = ${dataName}[_s]; }`
    )
    this.emit(`BC_SPR_PTR[${slot}] = BC_SPR_BLOCK0 + (${slot});`)
    // Individual per-sprite colour (the "10" pair), chosen in the sprite editor and
    // stored in the .sprite — so player and blob can differ.
    this.emit(`VIC.spr_color[${slot}] = ${colorConst(spriteColor)};`)
    if (this.gfxColor === 'MULTICOLOR') {
      // Mark this slot multicolor + set the two SHARED registers from the project
      // palette (the coupling bgcolor1/2 = spr_mcolor0/1 — memory project-palette),
      // so sprite colours match what the editor painted.
      const pal = this.palette(s)
      this.emit(`VIC.spr_mcolor |= (1 << (${slot}));`)
      this.emit(`VIC.spr_mcolor0 = ${colorConst(pal.shared1)};`)
      this.emit(`VIC.spr_mcolor1 = ${colorConst(pal.shared2)};`)
    } else {
      this.emit(`VIC.spr_mcolor &= ~(1 << (${slot}));`)
    }
  }

  private genAssign(s: AssignStmt): void {
    this.checkNarrowing(s.target, s.value)
    // A string variable can't be assigned with `=` in C (it's a buffer); copy/append
    // into it instead, truncating at its capacity (S8.T2). Only a plain $-variable is
    // a buffer; a string array element / record field stays on the scalar path.
    if (s.target.kind === 'Identifier' && this.exprType(s.target) === 'string') {
      this.genStringAssign(s.target, s.value)
      return
    }
    this.emit(`${this.lvalue(s.target)} = ${this.expr(s.value)};`)
  }

  /** Build a string buffer from an assignment (S8.T2): flatten the `+` chain, copy the
   *  first operand, append the rest — all truncating. A numeric operand is rendered via
   *  Str$ (textArg), so `"Score: " + n` works. `sizeof(dst)` gives the buffer capacity. */
  private genStringAssign(target: Identifier, value: Expr): void {
    this.usesStrBuf = true
    const dst = this.lvalue(target)
    const cap = `sizeof(${dst})`
    const parts = this.flattenConcat(value)
    // The common build idiom is `s$ = s$ + …`: if the first operand IS the target, the
    // buffer already holds it — skip the no-op self-copy and just append the rest.
    const selfStart = parts[0].kind === 'Identifier' && parts[0].name === target.name
    if (!selfStart) this.emit(`bc_scpy(${dst}, ${this.textArg(parts[0])}, ${cap});`)
    // parts[0] is now in the buffer (copied above, or already there if selfStart) →
    // append the rest.
    for (let i = 1; i < parts.length; i++) {
      this.emit(`bc_scat(${dst}, ${this.textArg(parts[i])}, ${cap});`)
    }
  }

  /** Flatten a left-leaning `a + b + c` string concatenation into [a, b, c]. */
  private flattenConcat(e: Expr): Expr[] {
    if (e.kind === 'Grouping') return this.flattenConcat(e.expr)
    if (e.kind === 'Binary' && e.op === '+') {
      return [...this.flattenConcat(e.left), ...this.flattenConcat(e.right)]
    }
    return [e]
  }

  /** The C element type for a Dim array: a scalar C type or `struct Name`. */
  private arrayElemCType(arr: ArrayInfo): string {
    if (arr.recordType) {
      const rec = this.records.get(arr.recordType)
      if (!rec) {
        // The lexer only attaches `.X` for a known record, so this is rare — but a
        // forward/typo case is possible; fail honestly rather than emit broken C.
        return `/* TODO: unbekannter Record '${arr.recordType}' */ unsigned char`
      }
      return `struct ${rec.cName}`
    }
    return C_TYPE[arr.type ?? 'byte']
  }

  /** Render any assignable place (variable, array element, record field) to C. */
  private lvalue(e: Identifier | IndexExpr | FieldExpr): string {
    switch (e.kind) {
      case 'Identifier':
        return cName(e.name)
      case 'IndexExpr':
        return this.indexExpr(e)
      case 'FieldExpr':
        return this.fieldExpr(e)
    }
  }

  /** Render an array element access `feld[i]` / `feld[s, z]` to C (Sprachdef §C). */
  private indexExpr(e: IndexExpr): string {
    const arr = this.arrays.get(e.name)
    if (!arr) {
      this.err(this.M.unknownArray(e.name), e)
      return `/* TODO: ${e.name}[] nicht deklariert */ 0`
    }
    if (e.indices.length === 2) {
      // 2D → flat: zeile * breite + spalte (spalte = first index, zeile = second).
      const rowOffset = this.rowTimesWidth(e.indices[1], arr.sizes[0])
      const spalte = this.expr(e.indices[0])
      return `${arr.cName}[${rowOffset} + (${spalte})]`
    }
    if (e.indices.length === 1) {
      return `${arr.cName}[${this.expr(e.indices[0])}]`
    }
    this.err(this.M.arrayIndexCount(e.name), e)
    return `${arr.cName}[0]`
  }

  /** The C for `row * width` inside a 2D index (STAHL S2b). The 6502 has no hardware
   *  multiply; cc65 already turns a power-of-two width into shifts, but a NON-power-of-two
   *  width — including the screen width 40 — compiles to its general software multiply
   *  (`jsr tosumula*`, hundreds of cycles). So for a constant width that is a sum of ≤3
   *  powers of two (40 = 32+8, the common tilemap case) we emit the shift/add chain
   *  ourselves, which cc65 turns into cheap shifts — VERIFIED at the asm. Guard: only when
   *  the row is a plain variable, since the chain evaluates it more than once (never
   *  duplicate a call/expression that could have side effects). Everything else stays a
   *  `*`: cc65 handles pure powers of two, and a variable width is a genuine multiply. */
  private rowTimesWidth(rowExpr: Expr, widthExpr: Expr): string {
    const rowC = this.expr(rowExpr)
    const width = this.constInt(widthExpr)
    if (rowExpr.kind !== 'Identifier' || width === undefined || width <= 0) {
      return `(${rowC}) * (${this.expr(widthExpr)})`
    }
    const bits: number[] = []
    for (let i = 0; 1 << i <= width; i++) if (width & (1 << i)) bits.push(i)
    if (bits.length > 3) return `(${rowC}) * (${this.expr(widthExpr)})` // too many adds
    // High bit first reads like the decomposition (40 = 32 + 8 → (r<<5)+(r<<3)).
    const terms = bits.reverse().map((i) => (i === 0 ? `(${rowC})` : `((${rowC}) << ${i})`))
    return terms.length === 1 ? terms[0] : `(${terms.join(' + ')})`
  }

  /**
   * The C for `row * BC_SCR_W` inside a screen offset. The text screen is 40 wide, and
   * 40 is NOT a power of two, so a literal `row * 40` compiles to cc65's slow software
   * multiply (the 6502 has no hardware multiply — memory: c64-math-cost-model). When the
   * row is safe to read twice we emit the shift/add chain (40 = 32 + 8 → (row<<5)+(row<<3))
   * — cc65 turns that into cheap shifts, the same strength reduction the 2D-array index
   * uses (rowTimesWidth, STAHL S2b). This keeps a per-frame, per-pixel TileSolid
   * (bc_tile_at) from dragging the frame past one screen refresh. The result is fully
   * parenthesized so a `+ col` after it binds correctly (`<<` is weaker than `+` in C).
   */
  private screenRowOffset(rowC: string, simple: boolean): string {
    if (!simple) return `(${rowC}) * BC_SCR_W`
    return `(((${rowC}) << 5) + ((${rowC}) << 3))`
  }

  /** Render a record field access `tasche[3]\count` / `p\x` → `base.count` (§C). A
   *  record PARAMETER is a const-pointer, so its field access uses `->` not `.`. */
  private fieldExpr(e: FieldExpr): string {
    const rec = this.recordOf(e.base)
    if (rec && !rec.fields.has(e.field)) {
      this.err(this.M.recordNoField(rec.cName, e.field), e)
    }
    // A local record-pointer param (`const struct X *p`) dereferences with `->`.
    if (e.base.kind === 'Identifier') {
      const local = this.localScope?.get(e.base.name)
      const arrow = local?.isPointer ? '->' : '.'
      return `${cName(e.base.name)}${arrow}${cName(e.field)}`
    }
    const baseC = this.indexExpr(e.base)
    return `${baseC}.${cName(e.field)}`
  }

  /** The record type backing a field-access base (an array element, or a scalar record
   *  local/param inside a function). */
  private recordOf(base: Identifier | IndexExpr): RecordInfo | undefined {
    if (base.kind === 'IndexExpr') {
      const arr = this.arrays.get(base.name)
      if (arr?.recordType) return this.records.get(arr.recordType)
      return undefined
    }
    // A scalar record local/param (a record value or a record-pointer param).
    const local = this.localScope?.get(base.name)
    if (local?.recordType) return this.records.get(local.recordType)
    // Global scalar record variables aren't a thing yet (arrays cover §C's example).
    return undefined
  }

  private genIf(s: IfStmt): void {
    this.emit(`if (${this.expr(s.cond)}) {`)
    this.genBlock(s.then)
    for (const e of s.elifs) {
      this.emit(`} else if (${this.expr(e.cond)}) {`)
      this.genBlock(e.body)
    }
    if (s.else) {
      this.emit('} else {')
      this.genBlock(s.else)
    }
    this.emit('}')
  }

  private genWhile(s: WhileStmt): void {
    // The main frame loop is `While 1 … Wend`. VWait is written by the user (manual
    // placement, BlitzBasic-style — no hidden auto-insert, Sprachdef §F / memory
    // breadcraft-syntax-conventions); the transpiler WARNS if it's missing, so the
    // sprite doesn't rocket off-screen (the #1 C64 beginner trap).
    if (isConstOne(s.cond)) {
      if (!bodyHasVWait(s.body)) {
        this.err(
          this.M.frameLoopNoVWait(),
          s,
          'warn'
        )
      }
      this.emit('for (;;) {')
      this.genBlock(s.body)
      this.emit('}')
    } else {
      this.emit(`while (${this.expr(s.cond)}) {`)
      this.genBlock(s.body)
      this.emit('}')
    }
  }

  private genRepeat(s: RepeatStmt): void {
    this.emit('do {')
    this.genBlock(s.body)
    this.emit(`} while (!(${this.expr(s.until)}));`)
  }

  /** Evaluate a compile-time-constant integer (number literal, possibly negated or
   *  grouped). Returns undefined for anything not statically known — those fall back to
   *  the plain forward loop, which is the safe assumption for a runtime step. */
  private constInt(e: Expr | undefined, seen: Set<string> = new Set()): number | undefined {
    if (!e) return undefined
    switch (e.kind) {
      case 'NumberLit': {
        const radix = e.base === 'hex' ? 16 : e.base === 'bin' ? 2 : 10
        const n = parseInt(e.raw, radix)
        return Number.isNaN(n) ? undefined : n
      }
      case 'Unary':
        if (e.op === '-') {
          const inner = this.constInt(e.expr, seen)
          return inner === undefined ? undefined : -inner
        }
        return undefined
      case 'Grouping':
        return this.constInt(e.expr, seen)
      case 'Identifier':
      case 'ConstantRef': {
        // A user `Const W = 40` resolves to its value (so `Dim feld.b[W,25]` gets the
        // same shift/add specialization as a literal width). A name the parser left as
        // an Identifier that turns out to be a const counts too; a plain variable isn't
        // in `consts` → undefined (not compile-time known). `seen` guards a cycle.
        if (seen.has(e.name)) return undefined
        const v = this.consts.get(e.name)
        if (!v) return undefined
        seen.add(e.name)
        return this.constInt(v, seen)
      }
      default:
        return undefined
    }
  }

  private genFor(s: ForStmt): void {
    const v = cName(s.variable.name)
    const counterType = this.exprType(s.variable) ?? 'byte'
    const stepVal = this.constInt(s.step)
    const declName = s.variable.name

    // A constant Step 0 never moves the counter → endless loop. Catch it honestly.
    if (s.step && stepVal === 0) {
      this.err(this.M.forStep0(), s)
      return
    }

    if (stepVal !== undefined && stepVal < 0) {
      // Counting DOWN. An unsigned counter has no value below 0: at 0 it wraps to its
      // type maximum and `v >= to` stays forever true (Befund 3 / N5, e.g.
      // `For i = 10 To 0 Step -1` on a .b counter). Only a signed .i counter can step
      // through 0 into the negatives, so its `>=` comparison terminates correctly.
      if (counterType !== 'sint') {
        this.err(this.M.forDownNeedsSint(stepVal, declName), s)
        return
      }
      const mag = Math.abs(stepVal)
      this.emit(`for (${v} = ${this.expr(s.from)}; ${v} >= ${this.expr(s.to)}; ${v} -= ${mag}) {`)
      this.genBlock(s.body)
      this.emit('}')
      return
    }

    // Counting UP. The mirror trap: a constant `to` equal to the counter's type maximum
    // — after the last body run, `v += step` wraps past the max back to 0 and `v <= to`
    // is forever true (`For i = 0 To 255` on a .b counter). A bigger type fixes byte;
    // for word/sint there is no wider unsigned, so it is an honest dead end.
    const max = TYPE_MAX[counterType]
    if (max !== undefined && this.constInt(s.to) === max) {
      this.err(
        this.M.forCounterOverflow(
          max,
          TYPE_LABEL[counterType],
          counterType === 'byte' ? declName : undefined
        ),
        s
      )
      return
    }

    const step = s.step ? this.expr(s.step) : '1'
    this.emit(`for (${v} = ${this.expr(s.from)}; ${v} <= ${this.expr(s.to)}; ${v} += ${step}) {`)
    this.genBlock(s.body)
    this.emit('}')
  }

  // ---- expressions ----

  /** True if `name` is a declared variable / const / array (i.e. a real value), as
   *  opposed to a function name — used to tell a forgotten-parens call (C5) apart from
   *  an ordinary identifier. */
  private isDeclaredName(name: string): boolean {
    return (
      (this.localScope?.has(name) ?? false) ||
      this.symbols.has(name) ||
      this.consts.has(name) ||
      this.arrays.has(name)
    )
  }

  /** A color argument: a constant (BLACK→COLOR_BLACK) or a raw expression (0–15). */
  private colorArg(e: Expr | undefined): string {
    if (!e) return '0'
    if (e.kind === 'ConstantRef' && COLOR_MACRO[e.name.toUpperCase()]) {
      return COLOR_MACRO[e.name.toUpperCase()]
    }
    return this.expr(e)
  }

  private expr(e: Expr): string {
    switch (e.kind) {
      case 'NumberLit':
        if (e.base === 'hex') return '0x' + e.raw
        if (e.base === 'bin') return '0b' + e.raw
        return e.raw
      case 'StringLit':
        return JSON.stringify(e.value) // safe C string literal with quotes/escapes
      case 'ConstantRef':
        // A color constant maps to its macro; other constants pass through (later
        // layers map the rest, e.g. JoyDir → JOY_*).
        return COLOR_MACRO[e.name.toUpperCase()] ?? e.name
      case 'Identifier':
        // A bare function name used as a value means the parens were forgotten on a
        // value-function (C5). Parens are mandatory (Konvention §E), so this is an
        // honest, fix-it-yourself error — not a cryptic cc65 failure later.
        if (this.functions.has(e.name) && !this.isDeclaredName(e.name)) {
          this.err(this.M.valueFuncNeedsParens(e.name), e)
        }
        return cName(e.name)
      case 'Grouping':
        return `(${this.expr(e.expr)})`
      case 'Unary': {
        // Always parenthesize: the parser already built the tree with CRUMB's
        // precedence; printing bare would let C's (different) precedence re-bind it
        // (Befund 1). Parens preserve the AST structure exactly.
        const op = OP_C[e.op.toLowerCase()] ?? e.op
        return `(${op}${this.expr(e.expr)})`
      }
      case 'Binary': {
        // Always parenthesize — see Unary above. e.g. CRUMB `a + b Shl 2` parses as
        // `a + (b Shl 2)` (Shl binds like *); without parens C reads `(a + b) << 2`.
        const op = OP_C[e.op.toLowerCase()] ?? e.op
        return `(${this.expr(e.left)} ${op} ${this.expr(e.right)})`
      }
      case 'IndexExpr':
        return this.indexExpr(e)
      case 'FieldExpr':
        return this.fieldExpr(e)
      case 'CallExpr':
        return this.callExpr(e)
    }
  }

  /** Map a BreadCraft function call to its C expression. Tile-world reads (M3.T1)
   *  are wired here; the rest still report an honest "no C-mapping yet". */
  private callExpr(e: CallExpr): string {
    const name = e.callee.toLowerCase()
    const a = e.args
    switch (name) {
      case 'gettile': {
        // GetTile(col, row[, layer]) — layer 0 = display (Screen-RAM), 1 = data layer.
        if (a.length < 2) {
          this.err(this.M.getTileArgs(), e)
          return '/* GetTile: zu wenige Argumente */ 0'
        }
        this.usesTileWorld = true
        const off = `${this.screenRowOffset(this.expr(a[1]), a[1].kind === 'Identifier')} + (${this.expr(a[0])})`
        const layer = a.length >= 3 ? this.constLayer(a[2]) : 0
        if (layer === 1) {
          this.usesDataLayer = true
          return `BC_DATA[${off}]`
        }
        return `BC_SCREEN[${off}]`
      }
      case 'tileat':
        if (a.length < 2) {
          this.err(this.M.tileAtArgs(), e)
          return '/* TileAt: zu wenige Argumente */ 0'
        }
        this.usesTileWorld = true
        this.usesTileAt = true
        return `bc_tile_at(${this.expr(a[0])}, ${this.expr(a[1])})`
      case 'tilesolid':
        if (a.length < 2) {
          this.err(this.M.tileSolidArgs(), e)
          return '/* TileSolid: zu wenige Argumente */ 0'
        }
        this.usesTileWorld = true
        this.usesTileAt = true
        this.usesTileSolid = true
        // Solidity is looked up per TILE (STAHL S11): bc_solid[bc_tile_at(...)] — one
        // table-load on the resolved tile number, no wrapper function (it keeps the cheap
        // single-call-layer win from S10). Which tiles are solid is painted in the editor
        // and travels in the charset; an unmarked charset blocks nothing, so a wall blocks
        // but DrawText/HUD letters (also non-zero in Screen-RAM) do NOT — the bug S11 fixes.
        return `bc_solid[bc_tile_at(${this.expr(a[0])}, ${this.expr(a[1])})]`
      case 'abs':
        // Abs(n) → cc65's abs() (stdlib). The argument is cast to signed int so a
        // subtraction like Abs(a - b) reads as |a − b| even though BreadCraft values
        // are unsigned — the collision-distance case (the reason Into The Deep needs
        // it). cc65 has abs(); we just include <stdlib.h> when used.
        if (a.length < 1) {
          this.err(this.M.absArgs(), e)
          return '/* Abs: Argument fehlt */ 0'
        }
        this.usesStdlib = true
        return `abs((int)(${this.expr(a[0])}))`
      case 'min':
      case 'max': {
        // Min/Max aren't in cc65 — emit the BlitzBasic-style inline comparison (cheap,
        // no helper, no header). NOTE: each argument appears twice in the ternary, so a
        // side-effecting call as an argument would run twice; fine for the plain scalar
        // values these are used with (Min(hp + potion, MAXHP), Max(x, 0)).
        if (a.length < 2) {
          this.err(this.M.minMaxArgs(name === 'min'), e)
          return '/* Min/Max: zu wenige Argumente */ 0'
        }
        const op = name === 'min' ? '<' : '>'
        const x = this.expr(a[0])
        const y = this.expr(a[1])
        return `((${x}) ${op} (${y}) ? (${x}) : (${y}))`
      }
      case 'joystick': {
        // Joystick(RICHTUNG) → JOY_<DIR>(joy_read(JOY_2)) — the proven _preflight/
        // game.c read. The argument is a JoyDir constant (LEFT/RIGHT/UP/DOWN/FIRE);
        // anything else is an honest error (no axis values — C64 sticks are 5-bit).
        if (a.length < 1 || a[0].kind !== 'ConstantRef') {
          this.err(this.M.joystickDirArg(), e)
          return '/* Joystick: Richtung fehlt */ 0'
        }
        const macro = JOY_MACRO[a[0].name.toUpperCase()]
        if (!macro) {
          this.err(this.M.joystickBadDir(a[0].name), e)
          return '/* Joystick: ungültige Richtung */ 0'
        }
        this.usesJoystick = true
        return `${macro}(joy_read(JOY_2))`
      }
      case 'str$': {
        // Str$(n) → decimal text of a number, via the shared scratch buffer (S8.T1).
        if (a.length < 1) {
          this.err(this.M.strArgs(), e)
          return '/* Str$: Argument fehlt */ ""'
        }
        this.usesStrConv = true
        return `bc_str(${this.expr(a[0])})`
      }
      // ---- string functions (S8.T3): the cheap/HUD-useful ones are real ----
      case 'int':
        // Int(s$) → string → number (atoi). Invalid text → 0 (Sprachdef §E note).
        if (a.length < 1) return this.stringFnArgErr(e)
        this.usesStdlib = true
        return `((unsigned int)atoi(${this.expr(a[0])}))`
      case 'len':
        // Len(s$) → character count (strlen), as a byte.
        if (a.length < 1) return this.stringFnArgErr(e)
        this.usesStrLen = true
        return `((unsigned char)strlen(${this.expr(a[0])}))`
      case 'asc':
        // Asc(s$) → code of the first character (0 on an empty string).
        if (a.length < 1) return this.stringFnArgErr(e)
        return `((unsigned char)(${this.expr(a[0])})[0])`
      case 'chr$':
        // Chr$(n) → a 1-character string, via the shared scratch buffer.
        if (a.length < 1) return this.stringFnArgErr(e)
        this.usesChr = true
        return `bc_chr(${this.expr(a[0])})`
      // ---- the rich ones stay an honest "comes in Gate 3" stub, not a generic gap ----
      case 'left$':
      case 'right$':
      case 'mid$':
      case 'find':
        this.err(this.M.stringFnDeferred(e.callee), e)
        return `/* TODO ${e.callee}() (Gate 3) */ 0`
      case 'keydown':
      case 'keyhit':
        // Held/edge keyboard reads need a raw keyboard-matrix scan (column select +
        // row bit per key) — and KeyHit additionally needs auto-tracked last-frame
        // state. cc65 has no portable key API and the SSOT's KB_* values aren't real
        // cc65 symbols yet ("vollständige Belegung folgt"); no preflight proves the
        // matrix table. Honest deferral to a keyboard-input milestone, like UseSprite
        // / SetMetaTile — not a silent gap. Joystick already drives a playable sprite.
        this.err(this.M.keyboardDeferred(e.callee), e)
        return `/* TODO ${e.callee}() (Tastatur-Milestone) */ 0`
      default: {
        // A user-defined value function call (P1.T3): `Distance(a, b)`.
        const info = this.functions.get(e.callee)
        if (info) {
          if (info.returnRecord) {
            // A record-returning function uses an out-pointer, so it can't be a plain
            // sub-expression. Honest error pointing at the supported form.
            this.err(this.M.recordReturnInExpr(e.callee, info.returnRecord), e)
            return `/* ${e.callee}(): Record-Rückgabe nur als direkte Zuweisung */ 0`
          }
          if (e.callee === this.currentFunc) {
            this.err(this.M.recursion(e.callee), e)
          }
          return `${info.cName}(${this.callArgs(info, e.args)})`
        }
        this.err(this.M.funcNoMapping(e.callee), e)
        return `/* TODO ${e.callee}() */ 0`
      }
    }
  }

  /** Read a literal layer index (0/1) from a GetTile layer arg; non-literal → 0 with
   *  an honest note (the data layer is a compile-time choice in Phase 1). */
  private constLayer(e: Expr): number {
    if (e.kind === 'NumberLit' && e.base === 'dec') return e.raw === '1' ? 1 : 0
    this.err(this.M.getTileLayerConst(), e)
    return 0
  }
}

/**
 * Does this statement list contain a VWait somewhere (incl. inside If/For/etc.)?
 * Used to warn about a frame loop without frame-sync. Nested loops have their own
 * VWait check, so we don't descend into While/Repeat here (a VWait in an inner loop
 * doesn't sync the outer frame loop).
 */
function bodyHasVWait(body: Statement[]): boolean {
  for (const s of body) {
    switch (s.kind) {
      case 'CommandStmt':
        if (s.name.toLowerCase() === 'vwait') return true
        break
      case 'IfStmt':
        if (bodyHasVWait(s.then)) return true
        if (s.elifs.some((e) => bodyHasVWait(e.body))) return true
        if (s.else && bodyHasVWait(s.else)) return true
        break
      case 'ForStmt':
        if (bodyHasVWait(s.body)) return true
        break
      default:
        break
    }
  }
  return false
}

/** True for a literal constant `1` (the frame-loop marker `While 1`). */
function isConstOne(e: Expr): boolean {
  return e.kind === 'NumberLit' && e.base === 'dec' && e.raw === '1'
}

/** Map a BreadCraft identifier to a safe C identifier (drop suffix punctuation). */
function cName(name: string): string {
  // Suffix punctuation ($, .) is part of the written variable, not the C name.
  return name.replace(/[$]/g, '_str').replace(/[.]/g, '_')
}

/** A C-identifier-safe slug for an asset id (used in baked data names). */
function safeAssetName(id: string): string {
  const slug = id.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(slug) ? slug : `a_${slug}`
}

/** Format a byte array as indented C initializer rows (16 per line, readable). */
function byteRows(bytes: Uint8Array): string {
  const rows: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const row = Array.from(bytes.slice(i, i + 16)).join(', ')
    rows.push('  ' + row + (i + 16 < bytes.length ? ',' : ''))
  }
  return rows.join('\n')
}

/** Generate cc65-C from a parsed program. Never throws; errors are collected.
 *  `assets` lets tile/sprite commands bake real C64 bytes from the .bread. */
export function generate(
  program: Program,
  assets?: AssetContext,
  locale: Locale = DEFAULT_LOCALE
): CodeGenResult {
  return new Generator(assets, locale).generate(program)
}

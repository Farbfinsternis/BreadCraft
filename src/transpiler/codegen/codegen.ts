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
  Binary,
  IfStmt,
  WhileStmt,
  RepeatStmt,
  ForStmt,
  FunctionDecl,
  ReturnStmt,
  CallStmt
} from '../parser/ast'
import { pos } from '../parser/ast'
import {
  resolveCharset,
  resolveTilemap,
  resolveSprite,
  resolvePalette,
  resolveImage,
  AssetResolveError,
  type AssetManifest,
  type AssetReader,
  type ResolvedPalette,
  type ResolvedImage,
  type ResolvedTilemap
} from '../assets'
import { SCREEN_W, SCREEN_H } from '@shared/asset-formats'
import { levelCost, type ColorModel } from '@shared/level-cost'
import { planMemory, type MemoryMap } from './memory-map'
import { messages, DEFAULT_LOCALE, type CodegenMessages } from '../messages'
import { seedFontRegion } from '@shared/font-slots'
import type { EngineCost } from './perf-estimate'
import type { Locale, LevelInfo } from '@shared/ipc'

/** Raster lines in one PAL frame — the ruler the scrolling engine's tail is measured with
 *  (S1, Schritt 2). The engine's split lines are raster lines, so its deadlines are too. */
const RASTER_LINES = 312

/** Cycles in one PAL raster line — the exchange rate between the two rulers the tail is
 *  measured with (its work is cycles, its deadline is a raster line). */
const LINE_CYCLES = 63

/** Character columns actually SEEN while scrolling. The engine runs the screen in the VIC's
 *  38-column mode, because that is what hides the half-shifted edge behind the side border —
 *  so 40 columns are addressed and 38 are visible. The camera's travel is measured in these
 *  (S1 Schritt 2, T4b), or a level's last two columns would never be seen. */
const VISIBLE_W = 38

/** Cells the coarse step moves between two turns of its loop (S1, Schritt 3). Eight is
 *  where the measured curve flattens: it takes the loop's bookkeeping from seven cycles a
 *  cell to under two, and doubling it again would buy ~7 % more for twice the code. */
const UNROLL = 8

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

/** Max number of SIMULTANEOUSLY animated tile TYPES (AnimateTile registrations) — a
 *  fixed static table on the C64, no allocation. NOT a per-tile frame cap (frames are
 *  free up to 255) and NOT per map cell (one registration animates every cell showing
 *  the tile). Each slot costs 14 bytes of RAM, zero per-frame CPU (the tick loops over
 *  the live count, not this max). 32 gives a designer room for wide multi-tile lava
 *  bands plus a handful of distinct pickups. Drives both the C #define and the
 *  compile-time over-budget warning, so the two never drift. */
const ANIM_TILE_MAX = 32

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
  /** Base of the high BSS pool (big arrays above the graphics bank), or null for a
   *  single-pool layout — the second RAM bar measures against this (B1.T5). */
  highBase: number | null
  /** Top of the high BSS pool ($C800). */
  highCeiling: number
  /** What the emitted scrolling engine adds to a frame (S1.B4) — band height, whether the
   *  window travels, sprite slots the tail writes. null for a program without `UseMap`;
   *  the perf estimate then talks about the program's own code alone. */
  engine: EngineCost | null
  /** What the baked level costs in RAM (S1.B4), or null without `UseMap` — so the RAM bar
   *  can name the world's bytes instead of leaving them anonymous inside a full pool. */
  level: LevelInfo | null
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

/** A BreadCraft numeric/string type, inferred from a `.b`/`.w`/`.i`/`.s`/`$` suffix.
 *  `sint` (.i) and `sbyte` (.s) are the SIGNED ones — needed for velocities and for
 *  directions (physics). `.s` is the one-byte signed type (TYPEN-PLAN T3). */
type VarType = 'byte' | 'sbyte' | 'word' | 'sint' | 'string'

/** The C type each BreadCraft type maps to (Sprachdef §C table). */
const C_TYPE: Record<VarType, string> = {
  byte: 'unsigned char',
  sbyte: 'signed char', // signed 8-bit (-128..127) — directions, small deltas
  word: 'unsigned int',
  sint: 'int', // signed 16-bit (-32768..32767) — velocities, deltas, offsets
  string: 'char' // emitted as `char name[size]`; size from the assigned value (S8.T2)
}

/**
 * How many bytes each scalar costs in RAM. Only used to tell the user what a record
 * layout is doing to them (see `recordSizeNote`) — the RAM bar itself is measured from
 * the linked binary, never estimated.
 */
const TYPE_BYTES: Record<VarType, number | undefined> = {
  byte: 1,
  sbyte: 1,
  word: 2,
  sint: 2,
  string: undefined // sized per variable
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
  sbyte: 127,
  word: 65535,
  sint: 32767,
  string: undefined
}

/** Human label for the counting types, for honest For-loop diagnostics. */
const TYPE_LABEL: Record<VarType, string> = {
  byte: 'Byte',
  sbyte: 'Signed-Byte',
  word: 'Word',
  sint: 'Signed-Int',
  string: 'String'
}

/** The SIGNED types. Signedness is contagious in an expression (see exprType). */
const SIGNED_TYPES = new Set<VarType>(['sbyte', 'sint'])

/** Read the BreadCraft type from an identifier's written suffix. */
function suffixType(suffix: string | undefined): VarType | undefined {
  switch (suffix) {
    case '.b':
      return 'byte'
    case '.s':
      return 'sbyte'
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
const SCALAR_SUFFIXES = new Set(['$', '.b', '.s', '.w', '.i'])

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

/**
 * The operators that produce a VALUE (as opposed to a 0/1 flag). Only these can be
 * narrowed by TYPEN-PLAN T2: a comparison or a logical `And` already yields one bit,
 * so a cast there would be noise. `Xor` is bitwise and belongs here; `And`/`Or` are
 * CRUMB's LOGICAL operators (see OP_C: `&&` / `||`) and do not.
 */
const VALUE_OPS = new Set(['+', '-', '*', '/', 'mod', 'xor', 'shl', 'shr'])

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
  /** The display area set by the last `SetMode` (TEXT/BITMAP); drives requiresMode checks. */
  private gfxArea: 'TEXT' | 'BITMAP' | undefined
  /** The colour mode set by the last `SetMode` (HIRES/MULTICOLOR); UseSprite reads it
   *  to decide whether a baked sprite is multicolor (spr_mcolor bit + shared colours). */
  private gfxColor: 'HIRES' | 'MULTICOLOR' | undefined

  // ---- baked assets (UseTileset / DrawMap) ----
  /** File-scope `static const` data blocks baked from resolved assets (charset bytes,
   *  map tiles). Emitted between the arrays and main(), like Dim arrays. */
  private readonly bakedData: string[] = []
  /** True once a charset has been baked → the $D018/VIC.addr + memory-map #defines
   *  are needed in the header and a tileset is "active" for DrawMap. */
  private activeTileset: string | undefined
  /** The picture baked by `UseImage` (B2.T3), or undefined. Phase 1 shows ONE picture: it
   *  is linked straight into the bank's bitmap area, and there is exactly one such area —
   *  so a second, different `UseImage` is an honest error rather than a silent overwrite. */
  private activeImage: string | undefined
  /** The baked picture's id from the UP-FRONT pre-scan (B2.T4). DrawImage validates against
   *  THIS rather than `activeImage`, so it works inside a function — functions are emitted
   *  before the top-level, where the UseImage usually sits (the DrawMap trap). */
  private bakedImageId: string | undefined
  /** The baked picture's own background colour ($D021), kept for DrawImage to poke. */
  private imageBackground: number | undefined
  /** The memory plan, computed UP FRONT (before the walk) from a pre-scan of the program.
   *  $D018 is emitted mid-walk by UseTileset/UseImage, but the addresses it encodes depend
   *  on whether the program bakes a picture (the bitmap pushes the charset/screen down) —
   *  which may be declared later in the file. Planning first keeps ONE truth for the
   *  addresses the C bakes and the cfg reserves (the two-truths class, Befund 23). */
  private gfxMap!: MemoryMap

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

  // ---- the scrolling world (S1.B3: PlayField / UseMap) ----
  /** The play field: which SCREEN ROWS scroll. Compile-time on purpose — the raster split
   *  lines are constants in the generated program, so the band cannot be a variable. */
  private playField: { first: number; last: number } | undefined
  /** The world entered by `UseMap`. A program has one (a second is an honest error): the
   *  level lives in RAM as one baked block, and swapping it means loading from disk. */
  private levelWorld:
    | {
        id: string
        columns: number
        model: ColorModel
        /** Band rows stored per column, and the bytes the whole level occupies — reported
         *  out so the RAM bar can name the world's share of a full pool (S1.B4). */
        bandRows: number
        bytes: number
        tilesDecl: number
        colorsDecl: number
      }
    | undefined
  /** Record-array elements this FUNCTION holds a pointer to: `array#index` → C pointer
   *  name (S1.B5.T3). Filled per function by planRecordPointers, empty at top level. */
  private recordPtrs = new Map<string, string>()
  /** The `UseMap` STATEMENT has been walked — the world is entered from here ON. Separate
   *  from `levelWorld`, which the pre-scan sets before the walk (S1.B5): the two order
   *  diagnostics ("PlayField comes too late", "a second world") are about the statement
   *  order in the file, not about what the pre-scan already knows. */
  private useMapSeen = false
  /** `SetMapTile` used → the baked level stops being `const`: the program changes its own
   *  world, and the change has to survive the column scrolling out and back (S1.B3.4). */
  private usesSetMapTile = false
  /** `SetCameraX`/`CameraX()`/`Follow` used → emit the camera and the coarse shift that
   *  moves the band (S1.B3.2). A world that never moves its window pays none of it. */
  private usesCamera = false
  /** Highest sprite slot the program names, or 8 when a slot is a runtime expression —
   *  how many slots the frame's tail has to hand to the VIC (S1.B3.3). */
  private spriteSlotsUsed = 0
  /** A `Sprite n,x,y,frame` appeared → in a world the pointer swap is shadowed too, so a
   *  shape can never change while the beam is drawing that sprite. */
  private usesSpriteFrames = false

  // ---- animated tiles (AnimateTile): animated-charset trick ----
  /** AnimateTile used → emit the bc_anim_* registry + tick (cycles a tile's 8 charset
   *  bytes through consecutive frame slots) and hook bc_anim_tick() onto every VWait.
   *  Set in the first pass (collect) so the VWait hook is robust regardless of the
   *  order AnimateTile and VWait appear in. Needs an active tileset (BC_CHARSET). */
  private usesAnimTiles = false
  /** Count of AnimateTile call-sites emitted so far. Once it passes ANIM_TILE_MAX the
   *  runtime table is full and further registrations silently no-op on the C64, so we
   *  warn at compile time (once, on the call that overflows) instead of letting a tile
   *  quietly fail to animate. Counts statements, so a call in a loop is one — the
   *  runtime guard in bc_anim_add stays as the safety net for that rarer case. */
  private animTileCount = 0

  // ---- text output (DrawText / Color) ----
  /** DrawText used → emit the bc_drawtext helper (writes C64 screen codes straight to
   *  Screen-RAM, since conio's cputsxy writes PETSCII and mis-indexes a custom charset)
   *  and require the BC_SCREEN map. */
  private usesDrawText = false
  /** DrawText or Color used → emit the bc_pen pen-colour global (the Color command's
   *  state, read by every DrawText). */
  private usesPen = false
  /** Whole-program flag (set up front, before the walk): does the program draw text anywhere
   *  (DrawText / Color, even inside a loop or function)? Decided before UseTileset bakes the
   *  charset so the Hires font region can be seeded only when text is actually drawn — without
   *  it, a tile sitting on an empty low slot would gain a stray letter (MIXED_MODE_FONT_PLAN F2). */
  private willDrawText = false
  /** Cls used → emit the bc_cls helper. It clears the visible screen, which is the KERNAL's
   *  $0400 in bank 0 (clrscr) but the relocated BC_SCREEN in bank 1 (B1.T4) — and the bank
   *  isn't known until the memory plan, so Cls goes through a helper resolved at the end. */
  private usesCls = false

  // ---- sprites (M3.T2): Sprite / ShowSprite / HideSprite ----
  /** Any sprite command used. Sprites poke VIC registers directly (c64.h, always
   *  included), so no extra header is needed — the flag documents the dependency. */
  private usesSprites = false
  /** A site needed `bc_bit[]` — the eight single-bit masks as a table (TYPEN-PLAN T4).
   *  Set late (the world runtime asks for it after the header is built), which is why
   *  the table is assembled at the very end of generate() rather than pushed into
   *  `header`. Only emitted when something actually shifts by a runtime value. */
  private usesBitTable = false
  /** UseSprite used (P2.T3) → emit the sprite-shape memory-map #defines (the 64-byte-
   *  aligned data block above the charset + the pointer slots). */
  private usesSpriteData = false
  /** Compile-time block allocator for pointer-swap animation (SPRITE_ANIMATIONS.md SA2).
   *  Every UseSprite draws one 64-byte block PER FRAME from the shared sprite island; the
   *  cursor is the running base, the budget the island's ceiling (memory-map spriteBlocksAvail).
   *  When `cursor + frames.length` would cross the budget we fail the build HONESTLY rather
   *  than let the game show a neighbour's bytes at runtime ([[breadcraft-limits-philosophy]]). */
  private spriteBlockCursor = 0
  /** How many 64-byte sprite blocks the island holds — set up front from the memory plan
   *  (the bank depends on whether a charset is baked, so it's pre-scanned in generate). */
  private spriteBlockBudget = 0
  /** Constant slot → its baked frame count, from a pre-scan of UseSprite (SA4). Lets
   *  `Sprite n,x,y,frame` warn (best-effort) when a constant `frame` is past the last one.
   *  Pre-scanned because Sprite calls inside functions are emitted before the top-level
   *  UseSprite that defines the slot. Only constant-slot UseSprites are recorded. */
  private readonly spriteFrameCount = new Map<number, number>()

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
    this.errors.push({ message, severity, ...pos(at) })
  }

  /** Does the program draw text (DrawText / Color) ANYWHERE — including inside loops,
   *  conditionals or functions? A generic deep walk (resilient to any block-bearing node
   *  kind) over the AST, so UseTileset's font-region seeding can be gated on real text use
   *  even though those statements may be parsed after UseTileset (MIXED_MODE_FONT_PLAN F2). */
  private programDrawsText(program: Program): boolean {
    let found = false
    const visit = (node: unknown): void => {
      if (found || node === null || typeof node !== 'object') return
      const rec = node as Record<string, unknown>
      if (rec.kind === 'CommandStmt') {
        const name = String(rec.name).toLowerCase()
        if (name === 'drawtext' || name === 'color') {
          found = true
          return
        }
      }
      for (const key of Object.keys(rec)) {
        const v = rec[key]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === 'object') visit(v)
      }
    }
    program.body.forEach(visit)
    return found
  }

  /** Does the program bake a charset (any UseTileset, anywhere)? A custom charset moves
   *  graphics to bank 1, which shrinks the sprite island to 16 blocks; without one a
   *  sprites-only program stays in bank 0 with 32. The sprite-block allocator (SA2) needs
   *  this budget at the FIRST UseSprite, which may be parsed before UseTileset — so it's
   *  pre-scanned up front, the same shape as programDrawsText. */
  private programUsesCharset(program: Program): boolean {
    return this.programUsesCommand(program, 'usetileset')
  }

  /** Does the program bake a picture? The bitmap owns the bank's top half, pushing the
   *  charset/screen/sprites down (B2.T3) — so the addresses UseTileset bakes depend on a
   *  UseImage that may appear later in the file. Pre-scanned up front, like the charset. */
  private programUsesImage(program: Program): boolean {
    return this.programImageId(program) !== undefined
  }

  /** The id of the picture this program bakes (`UseImage "titel"`), or undefined.
   *
   *  Pre-scanned up front so `DrawImage` works ANYWHERE — including inside a function.
   *  Functions are emitted before the top-level, so a walk-order check would see no baked
   *  image yet and reject the very shape this split exists for (a game's GoTitle() showing
   *  the title again). That's the DrawMap-in-a-function trap; images sidestep it. */
  private programImageId(program: Program): string | undefined {
    let id: string | undefined
    const visit = (node: unknown): void => {
      if (id !== undefined || node === null || typeof node !== 'object') return
      const rec = node as Record<string, unknown>
      if (rec.kind === 'CommandStmt' && String(rec.name).toLowerCase() === 'useimage') {
        const args = rec.args as Expr[] | undefined
        const first = args?.[0]
        if (first && first.kind === 'StringLit') id = first.value
        return
      }
      for (const key of Object.keys(rec)) {
        const v = rec[key]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === 'object') visit(v)
      }
    }
    program.body.forEach(visit)
    return id
  }

  /**
   * The world this program enters, found BEFORE the walk (S1.B5) — the same medicine
   * `UseImage` already takes, and for the same illness.
   *
   * WHY IT MUST BE UP FRONT. Functions are emitted before the top-level code, but they RUN
   * after it. A game's `DrawPlayer()` is written above the `UseMap` that enters the world
   * and called from the frame loop below it — so a walk-order check sees no world yet and
   * emits the PRE-WORLD shape into a scrolling program: `Sprite` writing the VIC registers
   * directly instead of handing them to the frame's tail. The hero would then not ride on
   * the world (no camera conversion) and his registers would be written while the beam
   * draws the band. Wrong, and — worse — silent. Found while porting Into The Deep, which
   * is exactly what porting a real game is for (memory: breadcraft-verify-in-project).
   *
   * So the bake happens here, and every later decision ("does this statement speak the
   * world's language?") is simply right, wherever the statement stands. What stays at the
   * statement is everything about ORDER, because order is what the diagnostics are about:
   * a tileset must be active, `PlayField` must come first, a second world is an error.
   */
  private prescanWorld(program: Program): void {
    const band = this.prescanPlayField(program)
    const id = this.prescanCommandString(program, 'usemap')
    // Without a band we cannot cut the level (which rows travel?), and without assets we
    // cannot read the map. Both are honest errors — raised by the statement, where the
    // user's cursor is; here we simply leave the world unbaked and let the walk report.
    if (!band || !id || !this.assets) return
    this.playField = band
    this.bakeWorld(id)
  }

  /** The first `PlayField first, last` with compile-time rows, or undefined. Range/constant
   *  complaints belong to the statement — this only reads what is already sound. */
  private prescanPlayField(program: Program): { first: number; last: number } | undefined {
    let band: { first: number; last: number } | undefined
    const visit = (node: unknown): void => {
      if (band || node === null || typeof node !== 'object') return
      const rec = node as Record<string, unknown>
      if (rec.kind === 'CommandStmt' && String(rec.name).toLowerCase() === 'playfield') {
        const args = rec.args as Expr[] | undefined
        const first = this.constInt(args?.[0])
        const last = this.constInt(args?.[1])
        if (first !== undefined && last !== undefined && first >= 0 && last <= SCREEN_H - 1 && first <= last) {
          band = { first, last }
        }
        return
      }
      for (const key of Object.keys(rec)) {
        const v = rec[key]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === 'object') visit(v)
      }
    }
    program.body.forEach(visit)
    return band
  }

  /** The first string argument of command `name` anywhere in the program. */
  private prescanCommandString(program: Program, name: string): string | undefined {
    let id: string | undefined
    const visit = (node: unknown): void => {
      if (id !== undefined || node === null || typeof node !== 'object') return
      const rec = node as Record<string, unknown>
      if (rec.kind === 'CommandStmt' && String(rec.name).toLowerCase() === name) {
        const first = (rec.args as Expr[] | undefined)?.[0]
        if (first && first.kind === 'StringLit') id = first.value
        return
      }
      for (const key of Object.keys(rec)) {
        const v = rec[key]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === 'object') visit(v)
      }
    }
    program.body.forEach(visit)
    return id
  }

  /** Is `name` (lower-case) used as a command anywhere in the program? */
  private programUsesCommand(program: Program, name: string): boolean {
    let found = false
    const visit = (node: unknown): void => {
      if (found || node === null || typeof node !== 'object') return
      const rec = node as Record<string, unknown>
      if (rec.kind === 'CommandStmt' && String(rec.name).toLowerCase() === name) {
        found = true
        return
      }
      for (const key of Object.keys(rec)) {
        const v = rec[key]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === 'object') visit(v)
      }
    }
    program.body.forEach(visit)
    return found
  }

  /** Pre-scan UseSprite calls with a constant slot, recording slot → baked frame count, so
   *  `Sprite n,x,y,frame` can warn (best-effort) on a constant frame past the end (SA4).
   *  Resolves quietly — any asset error is reported properly later in genUseSprite. */
  private collectSpriteFrameCounts(program: Program): void {
    if (!this.assets) return
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const rec = node as Record<string, unknown>
      if (rec.kind === 'CommandStmt' && String(rec.name).toLowerCase() === 'usesprite') {
        const args = rec.args as Expr[] | undefined
        const slotArg = args?.[0]
        if (slotArg?.kind === 'NumberLit' && args?.[1]) {
          const slotNum = Number(slotArg.raw)
          const id = this.stringArg(args[1])
          if (id && Number.isInteger(slotNum) && slotNum >= 0 && slotNum <= 7) {
            try {
              const resolved = resolveSprite(id, this.assets!.manifest, this.assets!.readFile, this.locale)
              this.spriteFrameCount.set(slotNum, resolved.frames.length)
            } catch {
              // genUseSprite reports resolve errors; the warn just won't fire for this slot.
            }
          }
        }
      }
      for (const key of Object.keys(rec)) {
        const v = rec[key]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v === 'object') visit(v)
      }
    }
    program.body.forEach(visit)
  }

  generate(program: Program): CodeGenResult {
    // Whole-program text detection up front (before the walk), so UseTileset can decide
    // whether to seed the Hires font region (F2). DrawText/Color may appear after UseTileset.
    this.willDrawText = this.programDrawsText(program)
    // The memory plan up front, from a pre-scan: the walk needs its addresses before the
    // declarations that shape it are all seen. UseTileset/UseImage emit $D018 mid-walk, and
    // the sprite-block allocator (SA2) needs the island budget at the FIRST UseSprite —
    // which may be parsed before the UseTileset/UseImage that decides the layout.
    // `usesSprites: true` is deliberate: sprites shift no address here (they sit BELOW the
    // charset in both bank-1 layouts), they only add the island — so asking for it up front
    // yields the same addresses while giving the allocator a budget to check against. The
    // final plan below re-asks with what the walk actually found (that one drives the cfg).
    // Which picture the program bakes, up front: DrawImage checks against this, so it may
    // sit inside a function that the codegen emits before it ever reaches the UseImage.
    this.bakedImageId = this.programImageId(program)
    this.gfxMap = planMemory({
      usesCharset: this.programUsesCharset(program),
      usesSprites: true,
      usesImage: this.bakedImageId !== undefined
    })
    this.spriteBlockBudget = this.gfxMap.spriteBlocksAvail
    // Slot → frame count, for the best-effort out-of-range warn on `Sprite n,x,y,frame` (SA4).
    this.collectSpriteFrameCounts(program)

    // First pass: collect declarations (types, globals, consts) so the second pass
    // can emit correctly-typed declarations and narrowing checks. Function signatures
    // are collected too (so calls can be checked/emitted before the def is reached).
    for (const s of program.body) {
      if (s.kind === 'FunctionDecl') this.collectFunction(s)
      else this.collect(s)
    }

    // Does this program enter a scrolling world? Answered BEFORE any function body is
    // emitted (S1.B5) — a function written above the `UseMap` still runs after it, and
    // `Sprite` inside it must hand the VIC to the frame's tail like every other sprite
    // in a world. Needs the consts collected just above (PlayField takes them).
    this.prescanWorld(program)

    // Emit each function definition into its own buffer (placed before main). Done
    // before the main body so call sites see resolved signatures.
    for (const s of program.body) {
      if (s.kind === 'FunctionDecl') this.genFunction(s)
    }

    // The main body: every top-level statement that isn't a function definition.
    for (const s of program.body) {
      if (s.kind !== 'FunctionDecl') this.genStatement(s)
    }

    // A world the program CHANGES (SetMapTile, S1.B3.4) cannot be `const` — and whether it
    // does is only known once the whole program has been read, which is why the two
    // declarations were remembered instead of decided when the level was baked.
    if (this.usesSetMapTile && this.levelWorld) {
      const unconst = (i: number): void => {
        this.bakedData[i] = this.bakedData[i].replace('static const ', 'static ')
      }
      unconst(this.levelWorld.tilesDecl)
      if (this.levelWorld.model === 'perCell') unconst(this.levelWorld.colorsDecl)
    }

    // Plan the C64 memory map from what this project actually bakes (STAHL S1). The
    // addresses below come from this single plan — and so does the returned linker
    // config, so the cfg's reserved regions and the C's pointers can never drift.
    const map = planMemory({
      usesCharset: !!this.activeTileset,
      usesSprites: this.usesSpriteData,
      usesImage: !!this.activeImage
    })

    const header = [
      '/* Generated by BreadCraft — do not edit by hand. */',
      '#include <conio.h>',
      '#include <c64.h>',
      '#include <cbm.h> /* waitvsync() */',
      ''
    ]
    // Tile-world memory map (B1.T4). A custom charset moves graphics to the top of VIC
    // bank 1: charset $7000 (copy target), screen $7800, sprites $7C00 — addresses all from
    // the memory plan. The charset is copied there at runtime (genUseTileset); direct-
    // linking it would force the .prg to pad up to $7000, so copy keeps the .prg compact.
    if (this.activeTileset) {
      header.push(`#define BC_CHARSET ((unsigned char*)${hx(map.charsetAddr!)}) /* charset copy target */`)
    }
    // BC_SCREEN is needed for the tile grid, for DrawText (which writes screen codes
    // straight into it) AND for a picture (in BITMAP mode the same page holds two of the
    // three cell colours). The geometry defines below are only the tile-collision origin.
    if (this.activeTileset || this.usesTileWorld || this.usesDrawText || this.activeImage) {
      header.push(`#define BC_SCREEN  ((unsigned char*)${hx(map.screenAddr)}) /* 40x25 screen RAM */`)
    }
    // A picture's third cell colour lives in Color-RAM, which is I/O at a FIXED address —
    // it moves with neither the VIC bank nor the memory plan (B2.T3).
    if (this.activeImage) {
      header.push(
        `#define BC_BITMAP  ((unsigned char*)${hx(map.bitmapAddr!)}) /* MC bitmap matrix (linked, not copied) */`,
        '#define BC_COLOR_RAM ((unsigned char*)0xD800) /* Color RAM — I/O, fixed */'
      )
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
    // UseSprite bakes shapes into 64-byte-aligned blocks (bank 1: $7C00+). Every FRAME gets
    // its own block (SA3): BC_SPR_DATA(i) = base + i*64 is the i-th block, i a compile-time
    // index from the block allocator (SA2) — no longer tied to the slot. A sprite-pointer
    // BC_SPR_PTR[slot] (screen page + $3F8) holds the BANK-RELATIVE block number
    // BC_SPR_BLOCK0 + i. All addresses + the block base come from the memory plan.
    if (this.usesSpriteData) {
      const spr = hx(map.spritesAddr!)
      header.push(
        `#define BC_SPR_DATA(i) ((unsigned char*)(${spr} + (unsigned int)(i) * 64))`,
        `#define BC_SPR_PTR  ((unsigned char*)${hx(map.spritePtrAddr)}) /* sprite-pointer slots 0..7 */`,
        `#define BC_SPR_BLOCK0 (${map.spriteBlock0})          /* bank-relative block of the island base */`,
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
      if (sym.type === 'string') {
        const decl = `char ${sym.cName}[${sym.strSize ?? DEFAULT_STR_CAP}];`
        if (sym.global) globalDecls.push(decl)
        else localDecls.push('  ' + decl)
        continue
      }
      // A name without `Global` becomes a local of main — and main's 16-bit locals get the
      // zero page too (see zeroPaged). Here it is even cheaper than in a function: main is
      // entered ONCE and a game never returns from it, so the register bank is saved a
      // single time instead of on every call. Measured on a representative frame loop:
      // runtime helper calls 10 → 4, of them 16-bit 9 → 3.
      // A file-scope global cannot be `register` — C does not allow it, and cc65 keeps
      // globals in absolute memory regardless (proven: #pragma bss-name "ZEROPAGE" leaves
      // them in DATA and the .prg byte-identical).
      if (sym.global) globalDecls.push(`${C_TYPE[sym.type]} ${sym.cName} = 0;`)
      else localDecls.push(`  ${this.zeroPaged(sym.type)}${C_TYPE[sym.type]} ${sym.cName} = 0;`)
    }
    if (globalDecls.length > 0) globalDecls.push('')
    if (localDecls.length > 0) localDecls.push('')

    // Baked asset data (charset bytes, map tiles) — file scope, like Dim arrays.
    const baked = this.bakedData.length > 0 ? [...this.bakedData, ''] : []

    // Slot → base-block table (SA3): UseSprite records each slot's frame-0 block here, and
    // `Sprite n,x,y,frame` (SA4) adds the frame index to swap the hardware pointer (1 byte).
    const spriteRuntime = this.usesSpriteData
      ? ['/* sprite slot → frame-0 base block (pointer-swap animation) */', 'static unsigned char bc_spr_base[8];', '']
      : []

    // Where the window stands. It comes FIRST because it is what every world question is
    // answered against — TileAt below reads it, and so does everything the scrolling
    // engine does (S1.B3.4). Every world has one, even a standing one: it is what the
    // window is REPAINTED from when something else has used the screen (S1 Schritt 2, T4 —
    // a full-screen image borrows the same screen RAM the band lives in).
    const worldWindow = this.levelWorld
      ? [
          '/* ---- where the window stands (S1.B3.2) ---- */',
          "static unsigned int bc_camx = 0;        /* the window's left edge, in world pixels */",
          'static unsigned int bc_shown_col = 0;   /* map column the band shows right now */',
          ''
        ]
      : []

    // Tile-world file-scope data + helpers (M3.T1), emitted only when used.
    const tileWorld = this.tileWorldDecls()

    // The scrolling engine (S1.B3), emitted only for a program that enters a world. It
    // needs the planned screen address: the coarse shift is assembler over absolute
    // addresses, so it must know where the band physically lives.
    const scrollEngine = this.scrollEngineDecls(map.screenAddr)

    // Animated-tile registry + tick (AnimateTile), emitted only when used. Needs
    // BC_CHARSET, which the active tileset guarantees (genAnimateTile errors otherwise).
    const animTiles = this.animTileDecls()

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
    // Cls / startup-clear helper (B1.T4/B1.T5). In bank 1 the visible screen is the
    // relocated BC_SCREEN, which conio's clrscr (hard-wired to $0400) wouldn't touch — so
    // clear it ourselves: 1000 cells to the space screen code AND a default colour. The
    // colour matters because a CUSTOM charset's slot $20 isn't guaranteed blank, so a
    // cleared cell could otherwise show that glyph in stale Colour-RAM (clrscr clears
    // $D800 too; we match it). Emitted whenever bank != 0 — the startup blank below needs
    // it, since the KERNAL only pre-clears $0400, not our relocated screen — OR Cls is
    // used. In bank 0 the screen IS $0400, so the stock clrscr is exactly right.
    if (this.usesCls || map.bank !== 0) {
      if (map.bank !== 0) {
        textDecls.push(
          '/* clear the (relocated) bank screen + colour RAM (clrscr would only clear $0400) */',
          `static void bc_cls(void) { unsigned int _i; for (_i = 0; _i < 1000; ++_i) { BC_SCREEN[_i] = 0x20; COLOR_RAM[_i] = ${this.penCellValue('COLOR_WHITE')}; } }`
        )
      } else {
        textDecls.push('static void bc_cls(void) { clrscr(); }')
      }
    }
    if (textDecls.length > 0) textDecls.push('')

    // One-time setup that must run at the very top of main, before the user's body
    // (e.g. installing the joystick driver). Kept apart from this.lines so it can't
    // be reordered by the user's code. Mirrors _preflight/game.c's joy_install.
    const setup: string[] = []
    // Switch the VIC to bank 1 BEFORE anything draws (B1.T4), so the charset/screen/sprites
    // it reads are the high-bank ones the program writes. CIA2 port A bits 0-1 select the
    // bank (inverted: bank 1 = %10); the DDR bits must be outputs first. Only a charset
    // program moves the bank (bank != 0); graphics-less/sprites-only stay on the KERNAL's
    // bank 0, byte-identical to before.
    if (map.bank !== 0) {
      setup.push(
        `  CIA2.ddra |= 0x03;                       /* CIA2 port A bits 0-1 = outputs */`,
        `  CIA2.pra = (CIA2.pra & 0xFC) | ${hx(map.ciaBankBits, 2)}; /* VIC bank ${map.bank} ($${(map.bank * 0x4000).toString(16).toUpperCase()}) */`,
        '  bc_cls();                                /* blank the relocated screen — the KERNAL only cleared $0400 */'
      )
    }
    if (this.usesJoystick) {
      setup.push('  joy_install(joy_static_stddrv); /* CIA joystick driver, port 2 */')
    }
    if (setup.length > 0) setup.push('')

    // User function definitions (P1.T3) live between the globals and main, so they
    // can see file-scope globals/arrays/structs and be called from main.
    const funcs = this.funcDefs.length > 0 ? [...this.funcDefs, ''] : []

    // The eight single-bit masks (TYPEN-PLAN T4). Built HERE, last, because the world
    // runtime above only asks for it while it is being assembled — after `header` was
    // closed. Costs eight bytes and buys away every runtime `1 << n`, which cc65 would
    // otherwise compile into a shift loop (`aslaxy`). Emitted only when something uses
    // it, so a program with constant sprite slots is byte-identical to before.
    const bitTable = this.usesBitTable
      ? [
          '/* the eight single-bit masks: `1 << n` with a runtime n is a loop, this is one lda */',
          'static const unsigned char bc_bit[8] = { 1, 2, 4, 8, 16, 32, 64, 128 };',
          ''
        ]
      : []

    const code = [
      ...header,
      ...defines,
      ...bitTable,
      ...structDecls,
      ...arrayDecls,
      ...baked,
      ...spriteRuntime,
      ...worldWindow,
      ...tileWorld,
      ...scrollEngine,
      ...animTiles,
      ...strHelpers,
      ...textDecls,
      ...globalDecls,
      ...funcs,
      'int main(void) {',
      ...localDecls,
      ...setup,
      ...this.lines,
      '',
      // A scrolling world runs on its own raster interrupt. A game loops forever and never
      // gets here — but a program that DOES end must hand the machine back able to breathe,
      // or BASIC returns to a dead keyboard.
      ...(this.levelWorld ? ['  bc_split_stop(); /* the KERNAL gets its beam back */', ''] : []),
      '  return 0;',
      '}',
      ''
    ].join('\n')
    return {
      code,
      errors: this.errors,
      linkerConfig: map.cfg,
      mainCeiling: map.mainCeiling,
      highBase: map.highBase,
      highCeiling: map.highCeiling,
      // What the scrolling engine costs, from the side that KNOWS (S1.B4): the band's
      // height, whether the window travels, how many sprite slots the tail writes. The
      // perf estimate reads these instead of guessing them a second time from the AST,
      // and the RAM bar gets the level's byte figure the bake actually produced.
      engine: this.levelWorld
        ? {
            usesCamera: this.usesCamera,
            bandRows: this.levelWorld.bandRows,
            spriteSlots: this.spriteSlotsUsed,
            colorModel: this.levelWorld.model
          }
        : null,
      level: this.levelWorld
        ? {
            id: this.levelWorld.id,
            columns: this.levelWorld.columns,
            bandRows: this.levelWorld.bandRows,
            bytes: this.levelWorld.bytes,
            model: this.levelWorld.model
          }
        : null
    }
  }

  /**
   * The scrolling engine (S1.B3.1), emitted only for a program that entered a world with
   * `UseMap`. This is the C form of the engine proven on real hardware in
   * `_intern/_preflight/scroll_t3.c`; the plan's measurements (`_intern/SCROLLING_PLAN.md`
   * T2b–T4) are what its shape is for.
   *
   * THE FRAME IS THE POINT. `$D016` shifts the WHOLE screen, so a scrolling band inside a
   * standing frame is a raster split: the fine-scroll value goes in one line above the
   * band, the standing value one line below it. That splits every frame into two windows:
   *
   *   SPLIT_IN..SPLIT_OUT   the beam DRAWS the band — nothing about it may change, but
   *                         thinking is free.
   *   after SPLIT_OUT       the beam is below the band — the only place the band may be
   *                         moved (S1.B3.2 puts the coarse shift here).
   *
   * WHO WRITES THE SPLIT (Schritt 2). A raster INTERRUPT does, not the program. When the
   * program itself waited for the two lines it had to be present at both of them, so its
   * own frame code only ever got the time the band takes to draw — `504 × H` cycles, a room
   * that SHRINKS as the band gets flatter, which is the opposite of what a game needs. With
   * the interrupt the program has to be nowhere; it only has to be back before the tail.
   * Measured on hardware (T1): a six-row band went from 2.774 to 16.363 cycles of thinking
   * time. Only the two register writes moved — the tail stays in the main program, because
   * cc65 keeps its temporaries and software stack in the zero page and C called from an
   * interrupt would trample the C it interrupted.
   */
  private scrollEngineDecls(screenAddr: number): string[] {
    if (!this.levelWorld || !this.playField) return []
    const name = safeAssetName(this.levelWorld.id)
    const rows = this.playField.last - this.playField.first + 1
    const colour =
      this.levelWorld.model === 'tileTable'
        ? `bc_lvlcol_${name}[bc_lvl_${name}[_s]]`
        : `bc_lvlcol_${name}[_s]`
    const out = [
      '/* ---- the scrolling world (proven in _preflight/scroll_t3.c) ---- */',
      `#define BC_BAND_TOP  ${this.playField.first}   /* first scrolling screen row */`,
      `#define BC_BAND_H    ${rows}   /* tile rows that travel */`,
      `#define BC_MAP_W     ${this.levelWorld.columns}   /* level columns */`,
      // The first raster line of a text row is 51 + 8*row; the split must be set one line
      // BEFORE the row it applies to, hence the -1.
      '#define BC_SPLIT_IN  (51 + 8 * BC_BAND_TOP - 1)',
      '#define BC_SPLIT_OUT (51 + 8 * (BC_BAND_TOP + BC_BAND_H) - 1)',
      // CSEL (bit 3) stays OFF: 38 columns hide the partially scrolled edge columns behind
      // the side border. Switching it per split could open the border — never do that here.
      `#define BC_D016_HUD  ${this.gfxColor === 'MULTICOLOR' ? '0xD0' : '0xC0'}   /* standing frame, ${this.gfxColor === 'MULTICOLOR' ? 'multicolor' : 'hires'} text */`,
      '#define BC_RASTER    (*(volatile unsigned char*)0xD012)',
      '',
      'static unsigned char bc_d016_band = BC_D016_HUD | 7;   /* what the split writes at the band\'s top */',
      'static unsigned char bc_phase = 0;          /* 0 = the band\'s top split comes next */',
      'static volatile unsigned char bc_tick = 0;  /* the frame turned over below the band */',
      'static unsigned char bc_last_tick = 0;',
      '',
      ...this.splitIrqDecls(),
      '/* one column of the level into one screen column (screen AND colour) */',
      'static void bc_fill_col(unsigned char scol, unsigned int mapcol) {',
      '  unsigned char row;',
      '  unsigned int _s = mapcol * BC_BAND_H;',
      '  unsigned int idx = (unsigned int)BC_BAND_TOP * BC_SCR_W + scol;',
      '  if (mapcol >= BC_MAP_W) {             /* the hidden margin past the level end */',
      '    for (row = 0; row < BC_BAND_H; ++row) { BC_SCREEN[idx] = 32; COLOR_RAM[idx] = 0; idx += BC_SCR_W; }',
      '    return;',
      '  }',
      '  for (row = 0; row < BC_BAND_H; ++row) {',
      `    BC_SCREEN[idx] = bc_lvl_${name}[_s];`,
      `    COLOR_RAM[idx] = ${colour};`,
      '    idx += BC_SCR_W;',
      '    ++_s;',
      '  }',
      '}',
      '',
      '/* Paint the whole window from the level, starting at map column `left`. Three callers,',
      '   one job: setting the world up, a camera CUT (the window landed somewhere else',
      '   entirely — honest cost, a frame\'s worth of work), and coming back from a mode that',
      '   used the screen for something else. Walking never does this; jumping does. */',
      'static void bc_fill_window(unsigned int left) {',
      '  unsigned char c;',
      '  for (c = 0; c < BC_SCR_W; ++c) bc_fill_col(c, left + c);',
      '}',
      ''
    ]
    // (bc_camx / bc_shown_col are emitted ahead of the tile world — see generate().)
    if (this.usesCamera) out.push(...this.cameraDecls(screenAddr, rows, name, colour))
    if (this.spriteSlotsUsed > 0) out.push(...this.spriteWorldDecls())
    if (this.usesSetMapTile) out.push(...this.setMapTileDecls(name, rows))
    out.push(
      '/* The frame turns over: wait for the tick the bottom split set, then move the band.',
      '   The program no longer has to BE anywhere at a given raster line — the interrupt',
      '   does the splitting — so everything it does between two VWaits gets the whole frame',
      "   minus this tail (SCROLLING_PLAN Schritt 2 T1: at a six-row band that is 16.363",
      '   cycles instead of the 2.774 the waiting technique could offer). */',
      'static void bc_vwait(void) {'
    )
    if (this.usesCamera) out.push('  unsigned int _r;')
    out.push(
      '  while (bc_tick == bc_last_tick) { }    /* …the beam has left the band */',
      '  bc_last_tick = bc_tick;'
    )
    if (this.usesCamera) {
      out.push(
        '  /* DOES THE STEP STILL FIT? Nothing holds the program back any more, so a frame',
        '     that ran long would shift the band while the beam is already drawing it — a',
        '     tear, which looks like broken hardware. Instead the step is DROPPED: the wish',
        '     stands, the world holds still for this one frame and catches up in the next.',
        "     Stuttering is an honest 'too much code'; tearing is not. ($D012 only counts to",
        '     255, so the ninth bit of the line lives in $D011.)',
        '',
        '     ASKED FIRST, BEFORE ANY TAIL WORK — and it used to be asked after the sprites',
        '     were already written, which cost the answer its meaning: the flush itself takes',
        "     raster lines, so on a tall band (where the slack is down to its floor) the",
        '     question was always answered "too late" and the world simply stopped scrolling.',
        '     Worse, the sprites HAD been moved by then, against a band that had not — so the',
        '     hero slid across a frozen world, falling through ground that was drawn elsewhere',
        '     and hitting walls that were not there. One missed step, three symptoms.',
        '     Skipping the flush too is what keeps hero and world in lockstep: on a dropped',
        '     frame NOTHING moves, which is the honest picture of "this frame was too long". */',
        '  if (bc_dir_col || bc_cut) {',
        '    _r = BC_RASTER | ((VIC.ctrl1 & 0x80) << 1);',
        '    if ((unsigned int)(_r - BC_SPLIT_OUT) > BC_TAIL_SLACK) return;',
        '  }'
      )
    }
    if (this.spriteSlotsUsed > 0) {
      out.push(
        '  /* Sprites: $D016 never moves a sprite, so where it appears on screen is our sum —',
        '     and the registers must be written here, below the band. Writing them while the',
        '     beam is inside the band would tear the sprite itself. */',
        '  bc_spr_flush();'
      )
    }
    if (this.usesCamera) {
      out.push(
        '  /* THE TAIL. The beam is below the band, so this is the only place the band may',
        '     be moved — and the coarse step is by far the most of it (Schritt 3 T1: 850',
        '     cycles per band row, 14 of the ~232 raster lines available for each row that',
        '     travels). Screen and colour move together, then the column the program decided',
        '     on lands in the edge they vacated. */',
        '  if (bc_dir_col || bc_cut) {',
        '    if (bc_cut) { bc_fill_window(bc_want_col); bc_cut = 0; }',
        '    else if (bc_dir_col > 0) { bc_shift_left(); bc_reveal_right(); }',
        '    else { bc_shift_right(); bc_reveal_left(); }',
        '    bc_dir_col = 0;',
        '    bc_shown_col = bc_want_col;',
        '  }',
        '  /* The fine scroll belongs to the column that was just moved — the pair travels',
        '     together, and the split writes it at the top of the next band. A frame that',
        '     dropped its step never gets here: half a step is a jump, not a scroll. */',
        '  bc_d016_band = BC_D016_HUD | bc_xscroll_next;'
      )
    }
    out.push('}', '')
    return out
  }

  /**
   * The raster interrupt that cuts the frame in two (S1, Schritt 2 — proven on hardware in
   * `_intern/_preflight/scroll_t5.c`). Twenty instructions, and every one of them earns its
   * place:
   *
   *   - It is entered through the KERNAL's IRQ vector at $0314 (A/X/Y are already saved on
   *     the stack by then) and left through **$EA81**, not $EA31 — $EA31 would scan the
   *     keyboard and cost more than the split itself.
   *   - It touches NO zero page. That is what makes it safe to interrupt cc65's C anywhere:
   *     the C runtime keeps its temporaries and its software stack down there.
   *   - It is armed one line EARLY and then waits for its own line. An interrupt arrives
   *     40–60 cycles late and jitters, a PAL line is 63 — a `$D016` written in the middle of
   *     a visible line shifts the rest of that line, a seam straight through the HUD. Waiting
   *     costs ~130 cycles a frame (0,7 %) and puts the write back in the border, exactly
   *     where the waiting technique had it.
   *   - **It waits for "at or past", never for "exactly".** That one letter is the difference
   *     between a seam and a dead machine (found by a real game, S1 Schritt 3 T3b). If the
   *     tail overruns into the band, this interrupt arrives after its line has already gone
   *     by — and `cpx / bne` then spins for a WHOLE FRAME waiting for that line to come round
   *     again, missing the other split on the way, which leaves the two-phase machine turned
   *     around and the game frozen with the tail's `VWait` waiting for a tick that never
   *     comes. `cmp / bcc` gives up instead: the split lands late, the picture shows a seam
   *     for that frame, and the machine keeps running. An over-tall play field is then
   *     something you SEE and can fix, not something that kills the program.
   */
  private splitIrqDecls(): string[] {
    return [
      '/* ---- the split hangs on an interrupt (S1, Schritt 2) ---- */',
      'static void bc_irq_split(void) {',
      '  __asm__("lda #$01");',
      '  __asm__("sta $d019");                  /* acknowledge the raster interrupt */',
      '  __asm__("lda %v", bc_phase);',
      '  __asm__("bne bcirqbot");',
      '  /* the top of the band: from this line down the world scrolls */',
      '  __asm__("bcirqw1: lda $d012");         /* armed a line early: meet the line… */',
      '  __asm__("cmp #%b", (unsigned char)BC_SPLIT_IN);',
      '  __asm__("bcc bcirqw1");                /* …but never wait for one already gone */',
      '  __asm__("lda %v", bc_d016_band);',
      '  __asm__("sta $d016");',
      '  __asm__("lda #$01");',
      '  __asm__("sta %v", bc_phase);',
      '  __asm__("lda #%b", (unsigned char)(BC_SPLIT_OUT - 1));',
      '  __asm__("sta $d012");',
      '  __asm__("jmp $ea81");',
      '  /* …and the bottom: the picture stands again, and the frame turns over */',
      '  __asm__("bcirqbot: lda $d012");',
      '  __asm__("cmp #%b", (unsigned char)BC_SPLIT_OUT);',
      '  __asm__("bcc bcirqbot");',
      '  __asm__("lda #%b", (unsigned char)BC_D016_HUD);',
      '  __asm__("sta $d016");',
      '  __asm__("inc %v", bc_tick);            /* the tail may run: VWait is waiting for this */',
      '  __asm__("lda #$00");',
      '  __asm__("sta %v", bc_phase);',
      '  __asm__("lda #%b", (unsigned char)(BC_SPLIT_IN - 1));',
      '  __asm__("sta $d012");',
      '  __asm__("jmp $ea81");',
      '}',
      '',
      '/* Hand the beam to the split: the KERNAL\'s timer interrupt off, ours in its place. */',
      'static void bc_split_start(void) {',
      '  unsigned char _d;',
      '  __asm__("sei");',
      '  CIA1.icr = 0x7F;                       /* the KERNAL\'s timer interrupt stops here */',
      '  _d = CIA1.icr;                         /* reading clears what was pending */',
      '  CIA2.icr = 0x7F;',
      '  _d = CIA2.icr;',
      '  (void)_d;',
      '  *(void (**)(void))0x0314 = bc_irq_split;',
      '  VIC.ctrl1 &= 0x7F;                     /* both split lines live below 256 */',
      '  VIC.rasterline = BC_SPLIT_IN - 1;',
      '  bc_phase = 0;',
      '  VIC.irr = 0x0F;',
      '  VIC.imr = 0x01;                        /* the raster is the only interrupt we want */',
      '  __asm__("cli");',
      '}',
      '',
      '/* A game loops forever and never gets here — but a program that DOES end must hand',
      '   the machine back able to breathe, or BASIC returns to a dead keyboard and an',
      '   interrupt vector pointing into memory that is no longer a program. */',
      'static void bc_split_stop(void) {',
      '  __asm__("sei");',
      '  VIC.imr = 0x00;',
      '  VIC.irr = 0x0F;',
      '  *(void (**)(void))0x0314 = (void (*)(void))0xEA31;',
      '  CIA1.icr = 0x81;                       /* the KERNAL gets its timer back */',
      '  __asm__("cli");',
      '}',
      ''
    ]
  }

  /**
   * The camera (S1.B3.2): the window that travels over the world, and the coarse shift
   * that makes it travel. Emitted only when the program actually moves the window
   * (`SetCameraX`/`CameraX()`) — a standing world pays for none of it.
   *
   * THE SPLIT OF LABOUR IS THE WHOLE DESIGN (measured in SCROLLING_PLAN T2b–T4):
   *   - `$D016` shifts the picture 0–7 pixels for one register write. That is the smooth
   *     part, and it is free.
   *   - Every 8th pixel the band must physically move one column: ~1.331 cycles per band
   *     row for screen RAM, Color-RAM (the VIC does NOT scroll $D800) and the column that
   *     appears at the edge. That is the price, and it is paid in the tail.
   * So `SetCameraX` only DECIDES (in the program's own time, where thinking is free) and
   * `bc_vwait` MOVES (in the tail, below the band).
   *
   * WHY THE SHIFT IS ASSEMBLER — and only the shift. A cc65 loop costs ~67 cycles per
   * byte pair; the band is 400 bytes twice over. In C the step took 1,4 frames (it did not
   * just tear, it ate a whole frame every 8th step); as one indexed block copy in
   * assembler it is ~11.200 cycles and fits. Mass memory movement is the one place the
   * 6502 wants assembler — everything else here stays C.
   */
  private cameraDecls(screenAddr: number, rows: number, name: string, colour: string): string[] {
    const world = this.levelWorld!
    // HOW FAR THE WINDOW MAY TRAVEL — and it is NOT `columns − 40` (S1 Schritt 2, T4b).
    // Smooth scrolling needs the 38-column screen: the VIC's side borders then cover the
    // two outermost character columns, which is exactly where the half-shifted edge is
    // hidden. So 40 columns are addressed but only 38 are SEEN, and clamping the camera at
    // `columns − 40` left the level's last two columns behind the right border forever —
    // the user painted a wall there and never saw it. Clamping at `columns − 38` puts the
    // level's last column at the last VISIBLE one; the two hidden screen columns then ask
    // for map columns past the end, which bc_fill_col answers blank.
    const camMax = Math.max(0, (world.columns - VISIBLE_W) * 8)
    // The band is ONE block (rows × 40 bytes), so one indexed copy walks it — no per-row
    // setup. Shifting by a column moves every byte but the last, which the reveal writes.
    const bytes = rows * SCREEN_W - 1
    const scrBase = screenAddr + this.playField!.first * SCREEN_W
    const colBase = 0xd800 + this.playField!.first * SCREEN_W
    // How late the tail may start and still finish before the beam is back at the band's
    // top. Room below the band = 312 − 8·H raster lines; the step costs ~850 cycles per
    // band row = 13,5 lines (Schritt 3 T1, measured: 834 for the copy, 16 for the revealed
    // cell), plus the ~410 cycles the step pays once however tall the band is. Rounded UP
    // per row and generously at the fixed end, because the two ways of being wrong are not
    // equal: a deadline that is a touch early drops a step (the world holds still for one
    // frame), one that is late TEARS.
    //
    // AND THE SPRITES COUNT. They are written in this same tail, every frame, before the
    // step — so their cycles are part of what has to fit, and leaving them out of the sum
    // was what broke a fourteen-row play field: the slack said "two raster lines" while the
    // flush alone took seven, and every single step was refused.
    // A band so tall that nothing is left over keeps a hair of slack: the honest failure of
    // an over-tall band is the tear it always was, not a world frozen in place.
    const flushLines =
      this.spriteSlotsUsed > 0 ? Math.ceil((40 + 90 * this.spriteSlotsUsed) / LINE_CYCLES) : 0
    const tailLines = rows * 14 + 9 + flushLines
    const tailSlack = Math.max(2, RASTER_LINES - 8 * rows - tailLines)
    return [
      '/* ---- the camera and the coarse step (S1.B3.2) ---- */',
      `#define BC_CAM_MAX   ${camMax}   /* rightmost camera pixel — the level's right edge */`,
      `#define BC_TAIL_SLACK ${tailSlack}   /* raster lines the tail may start late by: ` +
        `${RASTER_LINES} − 8·${rows} of room, ${tailLines} for the step itself */`,
      '',
      'static unsigned char bc_xscroll_next = 7;   /* $D016 fine scroll for the next band */',
      'static unsigned int bc_want_col = 0;    /* map column the tail is to make it show */',
      'static signed char  bc_dir_col = 0;     /* columns for the tail to travel: -1 / 0 / +1 */',
      'static unsigned char bc_cut = 0;        /* the window jumped: redraw it whole */',
      `static unsigned char bc_edge_t[${rows}];   /* the column about to appear: tiles */`,
      `static unsigned char bc_edge_c[${rows}];   /* …and its colours */`,
      '',
      '/* the band travels one column LEFT (the world walks right) */',
      'static void bc_shift_left(void) {',
      ...this.asmShiftLeft('bcl', scrBase, colBase, bytes),
      '}',
      '',
      '/* …and one column RIGHT (walking back), which is the mirror image: the copy must',
      '   run downwards, or every byte overwrites the one it is about to read. */',
      'static void bc_shift_right(void) {',
      ...this.asmShiftRight('bcr', scrBase, colBase, bytes),
      '}',
      '',
      '/* The column the program decided on is stamped into the edge the shift just',
      '   vacated — unrolled absolute stores, because the addresses are known at build time',
      '   and a loop would cost more than the stores it saves. */',
      'static void bc_reveal_right(void) {',
      ...this.asmReveal(scrBase, colBase, rows, SCREEN_W - 1),
      '}',
      'static void bc_reveal_left(void) {',
      ...this.asmReveal(scrBase, colBase, rows, 0),
      '}',
      '',
      '/* Put the window at world pixel x. This only DECIDES — it runs while the program has',
      '   the frame, where the beam may be anywhere and touching the band would tear it.',
      '   The tail in bc_vwait does the moving. Signed on purpose: walking left past the',
      '   start is the natural thing to write (SetCameraX CameraX() - 2), and it must',
      '   clamp, not wrap. */',
      'static void bc_set_camx(int x) {',
      '  unsigned int mc, _s;',
      '  unsigned char row;',
      '  if (x < 0) x = 0;                     /* the level ends: the world stands still… */',
      `  if (x > ${camMax}) x = ${camMax};${camMax === 0 ? '   /* a level no wider than the screen never travels */' : '  /* …while the player may walk on */'}`,
      '  bc_camx = (unsigned int)x;',
      '  bc_xscroll_next = 7 - (bc_camx & 7);  /* the free part: one $D016 write per frame */',
      '  bc_want_col = bc_camx >> 3;',
      '  if (bc_want_col == bc_shown_col) { bc_dir_col = 0; bc_cut = 0; return; }',
      '  if (bc_want_col == bc_shown_col + 1) { bc_dir_col = 1; mc = bc_want_col + (BC_SCR_W - 1); }',
      '  else if (bc_want_col + 1 == bc_shown_col) { bc_dir_col = -1; mc = bc_want_col; }',
      '  else { bc_dir_col = 0; bc_cut = 1; return; }',
      '  bc_cut = 0;',
      '  /* Build the column that is about to appear. Past the level\'s last column it is the',
      '     hidden margin (see BC_CAM_MAX): blank, so nothing of the level is invented. */',
      '  if (mc >= BC_MAP_W) {',
      '    for (row = 0; row < BC_BAND_H; ++row) { bc_edge_t[row] = 32; bc_edge_c[row] = 0; }',
      '    return;',
      '  }',
      '  _s = mc * BC_BAND_H;',
      '  for (row = 0; row < BC_BAND_H; ++row) {',
      `    bc_edge_t[row] = bc_lvl_${name}[_s];`,
      `    bc_edge_c[row] = ${colour};`,
      '    ++_s;',
      '  }',
      '}',
      ''
    ]
  }

  /**
   * Sprites inside a world (S1.B3.3). Two things change the moment a program enters a
   * world with `UseMap`, and both are the honest consequence of one hardware fact:
   * **`$D016` moves the character matrix, never sprites.**
   *
   *   1. A SPRITE'S X IS A MAP PIXEL. It belongs to the level, so it speaks the level's
   *      coordinates — `Sprite PLAYER, px, py` puts the hero where he stands in the
   *      WORLD, and BreadCraft works out where that is on the screen
   *      (`screen = world − CameraX() + 24`). Walk far enough right and he leaves the
   *      window; the sprite is then switched off rather than wrapped around the screen.
   *   2. THE REGISTERS ARE WRITTEN IN THE TAIL, below the band. Writing a sprite's
   *      position while the beam is drawing it tears the sprite in half — so `Sprite`
   *      only remembers, and `VWait` hands the whole set to the VIC at once.
   *
   * `Follow` then needs no loop of its own: the camera is decided the moment the hero's
   * position is known, i.e. inside `Sprite`, which runs in the program's own time, where
   * thinking is free. A frame in which nobody moves the hero simply does not move the camera.
   */
  private spriteWorldDecls(): string[] {
    const n = this.spriteSlotsUsed
    // The tail's loop shifts by its own counter three times per slot — the one place in
    // the engine where `1 << i` can never be folded. It always takes the table (T4).
    this.usesBitTable = true
    return [
      '/* ---- sprites riding on the world (S1.B3.3) ---- */',
      `#define BC_SPR_N     ${n}   /* slots this program names */`,
      '#define BC_SPR_MID   148   /* camera at which the hero stands in the middle',
      '                             (160 = half the window, minus half a 24-pixel sprite) */',
      '',
      `static unsigned int bc_spr_mx[${n}];    /* where each sprite stands in the WORLD */`,
      `static unsigned char bc_spr_my[${n}];`,
      // THE SHAPE IS SHADOWED TOO, always — not only when a program swaps frames. The tail
      // is the only place the VIC's sprite registers may be written, so it stamps the whole
      // set every frame, pointer included. A sprite whose shape lived ONLY in the hardware
      // register (because that sprite never names a frame) would have it overwritten with a
      // zero the first time the tail served it, and turn into a blank square — which is
      // exactly what happened to Into The Deep's blobs while the animated diver was fine
      // (S1 Schritt 2, T4b).
      `static unsigned char bc_spr_ptr[${n}];   /* shape block, stamped by the tail */`,
      'static unsigned char bc_spr_want = 0;   /* which sprites the program wants shown */',
      '',
      ...(this.usesCamera
        ? [
            'static unsigned char bc_follow_spr = 0xFF;  /* the sprite the camera hangs on */',
            'static unsigned int bc_follow_dead = 0;     /* how far it may stray from the middle */',
            '',
            '/* The camera reacts where the hero is known, one frame before it',
            '   matters. Inside the dead zone the world stands still and he walks; outside it,',
            '   the world is pulled along until he is back on its edge. */',
            'static void bc_follow_now(unsigned int mx) {',
            '  int mid = (int)mx - BC_SPR_MID;       /* the camera that would centre him */',
            '  int cam = (int)bc_camx;',
            '  if (mid > cam + (int)bc_follow_dead) cam = mid - (int)bc_follow_dead;',
            '  else if (mid < cam - (int)bc_follow_dead) cam = mid + (int)bc_follow_dead;',
            '  else return;                          /* still on his leash: nothing moves */',
            '  bc_set_camx(cam);',
            '}',
            ''
          ]
        : []),
      '/* `Sprite n, x, y` in a world: remember, decide, and let the tail do the writing. */',
      'static void bc_sprite(unsigned char n, unsigned int mx, unsigned char my) {',
      '  bc_spr_mx[n] = mx;',
      '  bc_spr_my[n] = my;',
      ...(this.usesCamera ? ['  if (n == bc_follow_spr) bc_follow_now(mx);'] : []),
      '}',
      '',
      '/* The tail hands the whole set to the VIC at once. A sprite whose world position is',
      "   outside the window is switched OFF — the VIC's X is 9 bits and cannot express",
      '   "left of the screen", so it would otherwise reappear on the wrong side. */',
      'static void bc_spr_flush(void) {',
      '  unsigned char i, ena = 0, hi = 0;',
      '  int sx;',
      '  for (i = 0; i < BC_SPR_N; ++i) {',
      '    if (!(bc_spr_want & bc_bit[i])) continue;',
      '    sx = (int)bc_spr_mx[i] - (int)bc_camx + 24;   /* 24 = the first visible pixel */',
      '    if (sx < 0 || sx > 343) continue;',
      '    VIC.spr_pos[i].x = (unsigned char)sx;',
      '    VIC.spr_pos[i].y = bc_spr_my[i];',
      '    BC_SPR_PTR[i] = bc_spr_ptr[i];',
      '    if (sx > 255) hi |= bc_bit[i];',
      '    ena |= bc_bit[i];',
      '  }',
      '  VIC.spr_hi_x = hi;',
      '  VIC.spr_ena = ena;',
      '}',
      ''
    ]
  }

  /**
   * `SetMapTile` (S1.B3.4): change the world, and the picture of it.
   *
   * TWO WRITES, ON PURPOSE. The level in RAM is what makes the change LAST — the column
   * may scroll out of the window and back, and the key must still be gone. Screen and
   * Color-RAM are only the current view of it, written when the cell happens to be on
   * screen. Writing just the screen would be the bug this word exists to prevent.
   *
   * This is the one place that pays the column multiply (`col × band height`), and it is
   * the right place: changing the world is rare, asking about it is not — which is why
   * `TileAt` reads the window instead (see tileWorldDecls).
   */
  private setMapTileDecls(name: string, rows: number): string[] {
    const perCell = this.levelWorld!.model === 'perCell'
    return [
      '/* ---- changing the world (S1.B3.4) ---- */',
      `static void bc_set_map_tile(unsigned int wx, unsigned char wy, unsigned char t${
        perCell ? ', unsigned char c' : ''
      }) {`,
      '  unsigned int mcol = wx >> 3;',
      '  unsigned char row, ry;',
      '  unsigned int idx;',
      '  if (wy < BC_SPR_Y0 || mcol >= BC_MAP_W) return;',
      '  ry = wy;',
      '  ry -= BC_SPR_Y0;',
      '  row = ry >> 3;                        /* the screen row this pixel falls in */',
      '  if (row < BC_BAND_TOP || row >= BC_BAND_TOP + BC_BAND_H) return; /* not the world */',
      '  /* the world itself — this is what survives the column scrolling away and back */',
      `  bc_lvl_${name}[mcol * BC_BAND_H + (row - BC_BAND_TOP)] = t;`,
      ...(perCell
        ? [
            '  if (c != 0xFF) {                     /* 0xFF = leave the colour as painted */',
            `    bc_lvlcol_${name}[mcol * BC_BAND_H + (row - BC_BAND_TOP)] = (c & 0x0F) | 8;`,
            '  }'
          ]
        : []),
      '  /* …and the picture of it, if that cell is inside the window right now */',
      '  if (mcol < bc_shown_col) return;',
      '  mcol -= bc_shown_col;',
      '  if (mcol >= BC_SCR_W) return;',
      '  idx = (unsigned int)row * BC_SCR_W + mcol;',
      '  BC_SCREEN[idx] = t;',
      perCell
        ? `  COLOR_RAM[idx] = (c != 0xFF) ? ((c & 0x0F) | 8) : bc_lvlcol_${name}[(wx >> 3) * BC_BAND_H + (row - BC_BAND_TOP)];`
        : `  COLOR_RAM[idx] = bc_lvlcol_${name}[t];`,
      '}',
      ''
    ]
  }

  /**
   * THE COARSE STEP, and the single most expensive thing a scrolling frame does. Every
   * eighth pixel the whole band moves one column, and the shape of this loop is what the
   * play field's ceiling is made of (SCROLLING_PLAN, Schritt 3):
   *
   *     shift per band row · H  ≤  19.656 − 504·H
   *
   * so 1.331 cycles a row put the ceiling at ten, and 850 put it at fourteen. Nothing
   * about the C64 changed in between — only these instructions.
   *
   * WHAT T1 MEASURED (five loops on real hardware, `_preflight/scroll_t6.c`, cycles per
   * band row at H=10): two separate indexed loops 1.274 · ONE interleaved loop 1.025 ·
   * interleaved and unrolled eight cells at a time 834. What is emitted here is the third,
   * and the saving is entirely in the loop CONTROL, not in the copying:
   *
   *   - INTERLEAVED. Screen-RAM and Colour-RAM move the same distance under the same
   *     index, so counting that index twice was paying twice for one piece of arithmetic.
   *     ($D800 has to travel at all because the VIC does not scroll it — `$D016` moves the
   *     character matrix and nothing else.)
   *   - UNROLLED EIGHT WIDE. `inx / cpx / bne` on every byte is seven cycles of
   *     bookkeeping against nine of work; advancing the index once per eight cells
   *     (`txa / clc / adc #8 / tax`) drops that to under two. The eight bodies differ only
   *     by a constant in the address, which the 6502 gets for free.
   *   - THE FLAT BAND STOPS BEING THE EXPENSIVE ONE. A band under 256 bytes used to pay a
   *     compare on every single byte, so a SIX-row band cost MORE per row (1.369) than a
   *     ten-row one (1.274) — the reason the perf model's straight line was a fifth too
   *     optimistic at H=6. Unrolled, the two measure 824 and 834: one constant, honestly.
   *
   * THE PRICE IS CODE. Each 256-byte block needs its own eight bodies, so this costs
   * roughly 100 bytes per block per direction — about 580 bytes at a ten-row band against
   * some 100 before. It is paid once per program, it shows up in the RAM bar like any
   * other code, and it buys four more rows of world.
   *
   * `bytes` is `rows × 40 − 1`: every cell but the last travels, and the reveal writes
   * that one. So `bytes % 8` is always 7 — the loop is written for any remainder anyway,
   * because a constant that is only true by accident is a trap for the next change.
   */
  private asmShiftLeft(tag: string, scrBase: number, colBase: number, bytes: number): string[] {
    const out = ['  __asm__("ldx #$00");']
    const tail = bytes % UNROLL
    const looped = bytes - tail
    const full = Math.floor(looped / 256)
    const partial = looped % 256
    let blk = 0
    // One cell, indexed: read the neighbour above, write it here — screen and colour.
    const cell = (k: number): string[] => [
      `  __asm__("lda %w,x", ${hx(scrBase + k + 1)}u);`,
      `  __asm__("sta %w,x", ${hx(scrBase + k)}u);`,
      `  __asm__("lda %w,x", ${hx(colBase + k + 1)}u);`,
      `  __asm__("sta %w,x", ${hx(colBase + k)}u);`
    ]
    const body = (at: number, label: string): string[] => {
      const o = [`  __asm__("${label}:");`]
      for (let k = 0; k < UNROLL; k++) o.push(...cell(at + k))
      return o
    }
    const step = (label: string, count?: number): string[] => [
      '  __asm__("txa");',
      '  __asm__("clc");',
      '  __asm__("adc #$08");',
      '  __asm__("tax");',
      ...(count === undefined ? [] : [`  __asm__("cpx #%b", (unsigned char)${count});`]),
      `  __asm__("bne ${label}");`
    ]
    // A whole 256-byte block ends when the index wraps back to zero — `tax` sets the flag
    // for it, so a full block needs no compare at all, and the next block starts where
    // this one left the index.
    for (let b = 0; b < full; b++) {
      const label = `${tag}${blk++}`
      out.push(...body(b * 256, label), ...step(label))
    }
    if (partial > 0) {
      const label = `${tag}${blk++}`
      out.push(...body(full * 256, label), ...step(label, partial))
    }
    // …and the handful the eights do not reach, at addresses known at build time.
    for (let k = 0; k < tail; k++) {
      const o = looped + k
      out.push(
        `  __asm__("lda %w", ${hx(scrBase + o + 1)}u);`,
        `  __asm__("sta %w", ${hx(scrBase + o)}u);`,
        `  __asm__("lda %w", ${hx(colBase + o + 1)}u);`,
        `  __asm__("sta %w", ${hx(colBase + o)}u);`
      )
    }
    return out
  }

  /**
   * The way home: the same copy walking DOWNWARDS, because ascending would overwrite each
   * byte just before reading it. Highest addresses first — the odd cells at the top, then
   * the blocks, each from its top end.
   *
   * The loop ends on the borrow out of zero (`sbc #8` leaves carry clear exactly once),
   * so the last turn is the one at index 0 and no compare is needed. That matters here
   * more than anywhere: in T3 the descending copy was the one that tore, and it tore over
   * two cycles a byte spent on comparing.
   */
  private asmShiftRight(tag: string, scrBase: number, colBase: number, bytes: number): string[] {
    const out: string[] = []
    const tail = bytes % UNROLL
    const looped = bytes - tail
    const full = Math.floor(looped / 256)
    const partial = looped % 256
    for (let k = tail - 1; k >= 0; k--) {
      const o = looped + k
      out.push(
        `  __asm__("lda %w", ${hx(scrBase + o)}u);`,
        `  __asm__("sta %w", ${hx(scrBase + o + 1)}u);`,
        `  __asm__("lda %w", ${hx(colBase + o)}u);`,
        `  __asm__("sta %w", ${hx(colBase + o + 1)}u);`
      )
    }
    let blk = 0
    const cell = (k: number): string[] => [
      `  __asm__("lda %w,x", ${hx(scrBase + k)}u);`,
      `  __asm__("sta %w,x", ${hx(scrBase + k + 1)}u);`,
      `  __asm__("lda %w,x", ${hx(colBase + k)}u);`,
      `  __asm__("sta %w,x", ${hx(colBase + k + 1)}u);`
    ]
    const body = (at: number, label: string): string[] => {
      const o = [`  __asm__("${label}:");`]
      for (let k = UNROLL - 1; k >= 0; k--) o.push(...cell(at + k))
      return o
    }
    const block = (at: number, from: number): string[] => {
      const label = `${tag}${blk++}`
      return [
        `  __asm__("ldx #%b", (unsigned char)${from});`,
        ...body(at, label),
        '  __asm__("txa");',
        '  __asm__("sec");',
        '  __asm__("sbc #$08");',
        '  __asm__("tax");',
        `  __asm__("bcs ${label}");`
      ]
    }
    if (partial > 0) out.push(...block(full * 256, partial - UNROLL))
    for (let b = full - 1; b >= 0; b--) out.push(...block(b * 256, 256 - UNROLL))
    return out
  }

  /** Stamp the prepared column into screen column `col` of every band row. */
  private asmReveal(scrBase: number, colBase: number, rows: number, col: number): string[] {
    const out: string[] = []
    for (let r = 0; r < rows; r++) {
      out.push(
        `  __asm__("lda %v+%b", bc_edge_t, (unsigned char)${r});`,
        `  __asm__("sta %w", ${hx(scrBase + r * SCREEN_W + col)}u);`,
        `  __asm__("lda %v+%b", bc_edge_c, (unsigned char)${r});`,
        `  __asm__("sta %w", ${hx(colBase + r * SCREEN_W + col)}u);`
      )
    }
    return out
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
        `static const unsigned int bc_row40[25] = { ${row40} };`
      )
      if (this.levelWorld) {
        // In a world the question is asked in WORLD pixels — the same coordinates the hero
        // stands in (S1.B3.4), so a program never has to hold two rulers at once.
        //
        // WHY IT STILL READS THE SCREEN. The band IS the level's window: screen column j
        // holds map column bc_shown_col + j, so the answer is identical to reading the
        // level — and it costs a subtract instead of the `column × band height` multiply
        // the level's layout would need on EVERY call (the record-array multiply trap).
        // Reading is the hot path (a platformer samples several tiles per frame), changing
        // the world is not: SetMapTile pays the multiply, TileAt does not.
        //
        // The honest edge: outside the window there is no answer, and 0 comes back. The
        // world you can ask about is the world you can see.
        out.push(
          '/* world pixel → tile at that cell (0 outside the window — see the note above) */',
          'static unsigned char bc_tile_at(unsigned int wx, unsigned char wy) {',
          '  unsigned int col;',
          '  unsigned char row, ry;',
          '  if (wy < BC_SPR_Y0) return 0;',
          '  col = wx >> 3;',
          '  if (col < bc_shown_col) return 0;',
          '  col -= bc_shown_col;',
          '  if (col >= BC_SCR_W) return 0;',
          '  ry = wy;',
          '  ry -= BC_SPR_Y0;',
          '  row = ry >> 3;',
          '  if (row >= 25) return 0;',
          '  return BC_SCREEN[bc_row40[row] + (unsigned char)col];',
          '}',
          ''
        )
      } else {
        out.push(
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

  /**
   * File-scope registry + tick for animated tiles (AnimateTile), emitted only when used.
   * The animated-charset trick: each registration remembers a stage tile, a run of
   * consecutive frame slots, and a tempo; bc_anim_tick() (called once per VWait) copies
   * the current frame's 8 bytes onto the stage tile every `tempo` frames. One 8-byte copy
   * animates every cell showing that tile (they all read the same charset bytes) — no
   * Screen-RAM writes, so the per-frame cost is a counter plus an occasional copy. A slot
   * offset is slot*8 up to 2040, so the byte index must be a 16-bit unsigned int, not a
   * byte. Capped at ANIM_TILE_MAX registrations (a small fixed table, no allocation);
   * genAnimateTile warns at compile time before the cap is reached.
   *
   * The natural authoring layout has the stage tile sit INSIDE the frame run (e.g. the key
   * is tile 160 and its frames are 160..163). Then the stage slot is also a frame's storage
   * and would be destroyed once another frame is copied over it — after one loop that frame
   * is gone. So each registration saves the stage slot's original 8 bytes (bc_anim_home),
   * and showing the frame whose source IS the stage slot restores from that copy instead of
   * reading the (now-overwritten) slot. The disjoint layout (stage outside the run) never
   * hits the home path and behaves identically.
   */
  private animTileDecls(): string[] {
    if (!this.usesAnimTiles) return []
    return [
      '/* animated tiles (AnimateTile): cycle a tile through consecutive frame slots; one',
      '   8-byte charset copy animates every cell showing it. bc_anim_tick() runs per VWait. */',
      `#define BC_ANIM_MAX ${ANIM_TILE_MAX}`,
      'static unsigned char bc_anim_n = 0;',
      'static unsigned char bc_anim_tile[BC_ANIM_MAX];   /* visible stage tile */',
      'static unsigned char bc_anim_first[BC_ANIM_MAX];  /* first frame slot */',
      'static unsigned char bc_anim_frames[BC_ANIM_MAX]; /* frame count */',
      'static unsigned char bc_anim_tempo[BC_ANIM_MAX];  /* VWaits per frame change */',
      'static unsigned char bc_anim_idx[BC_ANIM_MAX];    /* current frame */',
      'static unsigned char bc_anim_tk[BC_ANIM_MAX];     /* ticks since last change */',
      'static unsigned char bc_anim_home[BC_ANIM_MAX][8]; /* saved bytes of the stage slot */',
      '/* paint the current frame onto the stage tile; the frame stored in the stage slot',
      '   itself comes from the saved home copy (the slot has been overwritten by now). */',
      'static void bc_anim_show(unsigned char k) {',
      '  unsigned char dst = bc_anim_tile[k];',
      '  unsigned char src = (unsigned char)(bc_anim_first[k] + bc_anim_idx[k]);',
      '  unsigned int a = (unsigned int)dst * 8;',
      '  unsigned char i;',
      '  if (src == dst) {',
      '    for (i = 0; i < 8; ++i) BC_CHARSET[a + i] = bc_anim_home[k][i];',
      '  } else {',
      '    unsigned int b = (unsigned int)src * 8;',
      '    for (i = 0; i < 8; ++i) BC_CHARSET[a + i] = BC_CHARSET[b + i];',
      '  }',
      '}',
      'static void bc_anim_add(unsigned char tile, unsigned char first, unsigned char frames, unsigned char tempo) {',
      '  unsigned int a;',
      '  unsigned char i;',
      '  if (bc_anim_n >= BC_ANIM_MAX || frames == 0) return;',
      '  if (tempo == 0) tempo = 1;',
      '  bc_anim_tile[bc_anim_n] = tile;',
      '  bc_anim_first[bc_anim_n] = first;',
      '  bc_anim_frames[bc_anim_n] = frames;',
      '  bc_anim_tempo[bc_anim_n] = tempo;',
      '  bc_anim_idx[bc_anim_n] = 0;',
      '  bc_anim_tk[bc_anim_n] = 0;',
      '  /* save the stage slot so a frame stored there survives being overwritten */',
      '  a = (unsigned int)tile * 8;',
      '  for (i = 0; i < 8; ++i) bc_anim_home[bc_anim_n][i] = BC_CHARSET[a + i];',
      '  bc_anim_show(bc_anim_n); /* show frame 0 at once, no startup flicker */',
      '  ++bc_anim_n;',
      '}',
      'static void bc_anim_tick(void) {',
      '  unsigned char k;',
      '  for (k = 0; k < bc_anim_n; ++k) {',
      '    if (++bc_anim_tk[k] >= bc_anim_tempo[k]) {',
      '      bc_anim_tk[k] = 0;',
      '      if (++bc_anim_idx[k] >= bc_anim_frames[k]) bc_anim_idx[k] = 0;',
      '      bc_anim_show(k);',
      '    }',
      '  }',
      '}',
      ''
    ]
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
      case 'CommandStmt':
        // First-pass flag so the VWait → bc_anim_tick() hook fires no matter whether
        // AnimateTile appears before or after the loop's VWait (the second pass would
        // otherwise miss an AnimateTile placed after the VWait it should drive).
        if (s.name.toLowerCase() === 'animatetile') this.usesAnimTiles = true
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
      else this.emit(`${this.zeroPaged(l.type)}${C_TYPE[l.type ?? 'byte']} ${l.cName} = 0;`)
    }
    // Find repeatedly-visited record-array elements ONCE (S1.B5.T3) — the declarations go
    // above the body, and every field access below reads through them.
    this.recordPtrs.clear()
    for (const d of this.planRecordPointers(s.body)) this.emit(d)
    for (const st of s.body) this.genStatement(st)
    this.recordPtrs.clear()

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
        // Widening (no implicit float, §D). Two rules, in this order:
        //
        // WIDTH wins first: anything touching a 16-bit operand is 16-bit. A `.s` next
        // to a `.w` cannot stay one byte — the word's range does not fit in it.
        //
        // SIGN is contagious within a width: a velocity calc like `vy + GRAVITY` must
        // stay signed even if GRAVITY is written unsigned, and a direction `.s` beside
        // a `.b` must stay signed, or `bdir * SPEED` would read -1 as 255. So the pair
        // (byte, sbyte) yields `sbyte` — narrow AND signed, which is exactly what the
        // one-byte signed type was added for (TYPEN-PLAN T3).
        const l = this.exprType(e.left)
        const r = this.exprType(e.right)
        const wide = l === 'word' || r === 'word' || l === 'sint' || r === 'sint'
        const signed = SIGNED_TYPES.has(l as VarType) || SIGNED_TYPES.has(r as VarType)
        if (wide) return signed ? 'sint' : 'word'
        if (l === 'sbyte' || r === 'sbyte') return 'sbyte'
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
   * How many bytes one record costs. cc65 lays a struct out on the 6502 with NO alignment
   * padding, so this is simply the sum of the fields — which is what makes the stride
   * question below answerable at all.
   */
  private recordBytes(rec: RecordInfo): number | undefined {
    let total = 0
    for (const ftype of rec.fields.values()) {
      const n = TYPE_BYTES[ftype]
      if (n === undefined) return undefined // a string field: sized per variable, don't guess
      total += n
    }
    return total
  }

  /**
   * ★ THE STRIDE TRAP, and the reason it ships together with `.s` (TYPEN-PLAN T3).
   *
   * `blobs[i]` is, in C, `blobs + i × sizeof(struct)`. When that size is a power of two the
   * 6502 does it with shifts; when it is anything else cc65 calls a SOFTWARE MULTIPLY
   * ([[breadcraft-record-array-multiply-trap]]). Into The Deep's Blob is eight bytes and
   * pays nothing — but change one `.i` direction field to `.s` to save a byte, and the
   * record becomes SEVEN, and the saving is paid for many times over in a place the source
   * does not mention. Exactly the kind of invisible cost this language exists to refuse
   * ([[breadcraft-translation-doctrine]]).
   *
   * So it is said out loud rather than silently padded. Padding would spend the user's RAM
   * behind their back to buy back speed they never knew they had lost, and a generated
   * struct that does not match the fields as written is its own kind of lie. A warning
   * leaves the choice where it belongs and names both ways out.
   *
   * Only for ARRAYS: a lone record variable is never indexed, so it has no stride and this
   * would be noise. Sizes of 1 and 2 are powers of two and stay silent by themselves.
   */
  private checkRecordStride(s: DimStmt): void {
    const recordType = recordSuffixName(s.target.suffix)
    if (!recordType) return
    const rec = this.records.get(recordType)
    if (!rec) return
    const bytes = this.recordBytes(rec)
    if (bytes === undefined || bytes < 1) return
    if ((bytes & (bytes - 1)) === 0) return // a power of two: the index is a shift
    const next = 1 << Math.ceil(Math.log2(bytes))
    this.err(this.M.recordStride(recordType, bytes, next, next - bytes), s.target, 'warn')
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
    const where =
      target.kind === 'Identifier'
        ? `'${target.name}'`
        : target.kind === 'IndexExpr'
          ? `'${target.name}[…]'`
          : `'\\${target.field}'`

    // ★ THE GUARD RAIL FOR T2. Byte arithmetic now really wraps at 256 (see
    // narrowByteMath). Storing it into a byte is business as usual — it would have
    // been truncated either way. Storing it into a WIDE destination is the one place
    // where somebody plausibly expected the big number (`pixel.w = spalte * 8`), so
    // say it out loud instead of letting the value be quietly wrong. Not an error:
    // wrapping on purpose is legitimate, and forbidding it would be the wrong kind of
    // railing ([[breadcraft-limits-philosophy]]).
    if ((tt === 'word' || tt === 'sint') && this.isByteMath(value)) {
      this.err(this.M.byteMathIntoWide(where), value, 'warn')
      return
    }

    let reason: string | undefined
    if (tt === 'byte' && (vt === 'word' || vt === 'sint')) {
      reason = this.M.narrowByteReason()
    } else if (tt === 'word' && vt === 'sint') {
      reason = this.M.narrowWordReason()
    } else if (tt === 'sint' && vt === 'word') {
      reason = this.M.narrowSintReason()
    } else if (tt === 'sbyte' && vt !== 'sbyte' && vt !== 'string') {
      // Into a signed byte, EVERYTHING else can be lossy: a `.b` above 127 flips
      // negative, and the wide types simply do not fit. `.s` ← `.s` is the only
      // silent case.
      reason = this.M.narrowSbyteReason()
    } else if ((tt === 'byte' || tt === 'word') && vt === 'sbyte') {
      // Out of a signed byte into an UNSIGNED target: -1 arrives as 255 or 65535.
      // Same trap as .i → .w, one size down.
      reason = this.M.signedIntoUnsignedReason()
    }
    if (!reason) return
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
        // Declared at file scope in generate(); nothing to emit in the body — but this is
        // where the array's shape is finally known, so the cost of indexing it is checked.
        this.checkRecordStride(s)
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
      case 'setmode':
        this.genGraphics(s)
        break
      case 'vwait':
        // Frame sync (PAL 50Hz) — the proven cbm.h call (Sprachdef §F, _preflight/game.c).
        // In a scrolling world the frame is cut in two by a raster split (S1.B3.1), so
        // VWait becomes that turn-over: wait for the frame to tick over, then move the
        // band. Same word, same meaning ("one frame passes"), stronger engine.
        this.emit(this.levelWorld ? 'bc_vwait();' : 'waitvsync();')
        // Advance any AnimateTile registrations once per frame (cheap no-op if none).
        if (this.usesAnimTiles) this.emit('bc_anim_tick();')
        break
      case 'usetileset':
        this.genUseTileset(s)
        break
      case 'useimage':
        this.genUseImage(s)
        break
      case 'drawimage':
        this.genDrawImage(s)
        break
      case 'drawmap':
        this.genDrawMap(s)
        break
      case 'playfield':
        this.genPlayField(s)
        break
      case 'usemap':
        this.genUseMap(s)
        break
      case 'setcamerax':
        this.genSetCameraX(s)
        break
      case 'follow':
        this.genFollow(s)
        break
      case 'setmaptile':
        this.genSetMapTile(s)
        break
      case 'settile':
        this.genSetTile(s)
        break
      case 'animatetile':
        this.genAnimateTile(s)
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
        this.usesCls = true
        this.emit('bc_cls();')
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
   * `SetMode <area>, <colormode>` → the VIC mode bits (Sprachdef §E, _preflight/
   * tilemap.c). Phase 1: TEXT,HIRES | TEXT,MULTICOLOR | BITMAP,MULTICOLOR.
   *   - MCM (multicolor) = $D016 bit 4 (VIC.ctrl2): set for MULTICOLOR, clear for HIRES.
   *   - BMM (bitmap)     = $D011 bit 5 (VIC.ctrl1): set for BITMAP, clear for TEXT.
   * The charset pointer ($D018) belongs to UseTileset (a later layer), not here.
   */
  private genGraphics(s: CommandStmt): void {
    const area = this.constArg(s.args[0])
    // The color mode is optional and defaults to HIRES (the plain text screen, what
    // conio gives you) — so `SetMode TEXT` alone is the common UI/text case.
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
    this.emit(`/* SetMode ${area}, ${color} */`)
    // BMM bit (bitmap vs text) — and bit 7 is CLEARED on the way past, deliberately.
    //
    // $D011 is not a normal register: writing it sets the raster compare's 9th bit, but
    // READING it gives back the beam's current line 8. A plain `|=` therefore copies
    // wherever the beam happened to be into the interrupt's line number — and if the read
    // lands below raster 256, the split is suddenly armed for line 321, which does not
    // exist on a PAL frame. The interrupt then never fires again, `VWait` waits forever for
    // a tick that cannot come, and the whole game stops dead.
    //
    // Found by a real game (S1 Schritt 3, T3b): switching from the title picture back into
    // the world froze Into The Deep with $D011 = $9B. It had always been a coin toss — the
    // taller play field only changed the timing of that one read enough to make it land in
    // the bad half every time. The engine keeps both split lines below 256 anyway
    // (`bc_split_start`), so clearing the bit here costs nothing and can never be wrong.
    if (area === 'BITMAP') this.emit('VIC.ctrl1 = (VIC.ctrl1 | 0x20) & 0x7F;')
    else this.emit('VIC.ctrl1 = VIC.ctrl1 & 0x5F;   /* ~BMM, and bit 7 never written back */')
    // MCM bit (multicolor vs hires)
    if (color === 'MULTICOLOR') this.emit('VIC.ctrl2 |= 0x10;')
    else this.emit('VIC.ctrl2 &= ~0x10;')
    // COMING BACK TO A WORLD, the window has to be repainted (S1 Schritt 2, T4 — found by
    // porting Into The Deep). A full-screen image has no screen of its own: `DrawImage`
    // writes its colour layer into the very Screen-RAM the band lives in, so a game that
    // shows a title and returns lands in a world whose window is the picture's leftovers.
    // Walking would slowly heal it (each coarse step reveals one fresh column) — which is
    // worse than not healing at all, because it looks like a glitch rather than a bug.
    // The window belongs to the engine, so the engine restores it. The rows OUTSIDE the
    // band belong to the program, and it clears them itself (`Cls`).
    if (area === 'TEXT' && this.levelWorld && (this.currentFunc || this.useMapSeen)) {
      this.emit('bc_fill_window(bc_shown_col); /* the window belongs to the engine */')
    }
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

  /** A colour as the Color-RAM byte for TEXT (DrawText / Color / Cls). Text cells are
   *  rendered HIRES even in a MULTICOLOR-text project: we deliberately leave bit 3 CLEAR so
   *  the VIC draws crisp 8px glyphs (the C64 Mixed-Mode — bit 3 is per-cell, and tiles set
   *  it themselves). That also gives text the full 16-colour nibble back. The font glyphs
   *  live in the reserved Hires slots 0–63 (see _intern/MIXED_MODE_FONT_PLAN.md F2). Tiles
   *  keep their own `| 8` (genSetTile / genDrawMap) — they do NOT pass through here. */
  private penCellValue(colorExpr: string): string {
    return `(${colorExpr})`
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
   * `SetMode` deliberately left out. Without an asset context (no project), an honest
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

    // Mixed-Mode font (MIXED_MODE_FONT_PLAN F2): a custom charset replaces the ROM font,
    // so DrawText would index empty low slots and show nothing. When the program draws text,
    // seed the empty font slots (0–63) with the C64 ROM font — they render Hires (F1's pen
    // leaves bit 3 clear) next to the MC tiles. Painted glyphs are kept; gated on real text
    // use so a tile on an empty low slot never gains a stray letter.
    if (this.willDrawText) bytes = seedFontRegion(bytes)

    // B1.T4: the charset lives at the top of bank 1. It's copied there at runtime from a
    // const in RODATA — direct-linking into the bank would force the .prg to pad up from
    // $0801 to the charset (huge); copying keeps the const contiguous with the code, so the
    // .prg stays compact. The low RAM that holds the const is now plentiful (bank 1 freed
    // it), so the copy's ~2KB source costs little. Phase 1 has one charset (activeTileset).
    //
    // Bake ONCE per id, but emit the copy + $D018 on EVERY call: a program that switches
    // modes (a bitmap title screen, then back to the tile game) calls UseTileset again to
    // point the VIC back at text — re-baking would emit a second identical `const` and cc65
    // would reject the redefinition. Same shape as genUseImage.
    const dataName = `tileset_${safeAssetName(id)}`
    if (this.activeTileset !== id) {
      this.bakedData.push(
        `static const unsigned char ${dataName}[${bytes.length}] = {`,
        byteRows(bytes),
        '};'
      )
    }
    this.activeTileset = id

    this.emit(`/* UseTileset "${id}" */`)
    this.emit(`{ unsigned int _i; for (_i = 0; _i < ${bytes.length}; ++_i) BC_CHARSET[_i] = ${dataName}[_i]; }`)
    // Point the VIC at the screen + charset positions within the bank (the CIA2 bank switch
    // itself runs once in the setup block). The value comes from the memory plan, so $D018
    // and the copy target can't disagree. In a program that also shows a picture this is
    // the TEXT-mode value — UseImage writes the bitmap one, and whichever ran last wins,
    // which is exactly the mode the program is in.
    this.emit(`VIC.addr = ${hx(this.gfxMap.d018, 2)};`)
    // MC-text shared colours from the project palette (the "00/01/10" pairs; the
    // "11" pair is per-cell Color-RAM). Same registers the sprites share — one
    // project-wide truth (memory breadcraft-project-palette).
    const pal = this.palette(s)
    this.emit(`VIC.bgcolor[0] = ${colorConst(pal.background)};`)
    this.emit(`VIC.bgcolor[1] = ${colorConst(pal.shared1)};`)
    this.emit(`VIC.bgcolor[2] = ${colorConst(pal.shared2)};`)
  }

  /**
   * `UseImage "id"` → bake a painted Multicolor picture INTO the program (B2.T3/T4).
   *
   * The BAKE half of the Use/Draw pair the language already uses everywhere (UseTileset →
   * DrawMap, UseSprite → Sprite): UseImage makes the picture part of the program, DrawImage
   * puts it on the screen. The split isn't cosmetic — it falls exactly on the real work.
   * This emits NO runtime code (the linker does the placing), which is why the SSOT calls
   * it `cheap`; DrawImage carries the copying and is `expensive`.
   *
   * Unlike the charset (B1.T4), the 8000-byte bitmap matrix is LINKED STRAIGHT INTO the
   * bank at $6000 instead of being copied from a const: a const source would cost the
   * picture a SECOND time in low RAM (~10KB of ~18.5KB — half the pool for one image),
   * and the bitmap has exactly one legal home per bank anyway. The linker puts it there
   * via the BC_BITMAP segment (memory-map's IMAGE cfg) and the VIC reads it where it
   * lies — no C code ever touches it. The `const` exists purely to carry the bytes into
   * the .prg; NON-static, because external linkage is what makes cc65 emit an array that
   * nothing references (the B1.T2 lesson).
   *
   * The two 1000-byte colour planes DO travel as consts, for DrawImage to copy: Color-RAM
   * is I/O ($D800), which a .prg can't be loaded into, and the screen page must be
   * re-writable because a tile game overwrites it.
   */
  private genUseImage(s: CommandStmt): void {
    const id = this.stringArg(s.args[0])
    if (!id) {
      this.err(this.M.useImageName(), s)
      return
    }
    if (!this.assets) {
      this.err(this.M.useImageNoProject(id), s)
      return
    }
    // One bitmap area per bank → one picture per program. A second, DIFFERENT picture would
    // silently overwrite the first, so say so instead. (Streaming more pictures from disk is
    // the honest answer and a decided SILBER block.) The same id again is fine and useful:
    // it re-shows the picture.
    if (this.activeImage && this.activeImage !== id) {
      this.err(this.M.useImageTwice(this.activeImage, id), s)
      return
    }
    let img: ResolvedImage
    try {
      img = resolveImage(id, this.assets.manifest, this.assets.readFile, this.locale)
    } catch (e) {
      this.err(e instanceof AssetResolveError ? e.message : String(e), s)
      return
    }

    const base = safeAssetName(id)
    if (!this.activeImage) {
      this.bakedData.push(
        '#pragma rodata-name (push, "BC_BITMAP")',
        `const unsigned char img_${base}[${img.bitmap.length}] = {`,
        byteRows(img.bitmap),
        '};',
        '#pragma rodata-name (pop)',
        `static const unsigned char imgscr_${base}[${img.screen.length}] = {`,
        byteRows(img.screen),
        '};',
        `static const unsigned char imgcol_${base}[${img.color.length}] = {`,
        byteRows(img.color),
        '};'
      )
      // The picture's own background (pattern %00) — the import chose it to make every cell
      // legal, so it is the picture's truth, not the project palette's. DrawImage pokes it.
      this.imageBackground = img.background
    }
    this.activeImage = id
    // A pure build-time act: the bytes are in the .prg and the linker placed them. There is
    // nothing to run — which is exactly why the SSOT calls UseImage `cheap`. The comment
    // marks the spot in the C view; DrawImage does the visible work.
    this.emit(`/* UseImage "${id}" — baked, linked at ${hx(this.gfxMap.bitmapAddr!)}; DrawImage shows it */`)
  }

  /**
   * `DrawImage "id"` → show the baked picture (B2.T4).
   *
   * The whole runtime cost of a picture lives here: point the VIC at the bitmap + screen
   * page ($D018 — the piece `SetMode` deliberately leaves out, exactly like UseTileset's),
   * set the shared background ($D021), and copy the two 1000-byte colour planes into the
   * screen page and Color-RAM. `expensive` in the SSOT, and honestly so — ~2000 bytes moved.
   *
   * The 8000-byte matrix is NOT copied; UseImage linked it into place. That's why showing
   * the picture AGAIN is cheap: a game returning to its title screen only restores the
   * colours the tile world overwrote — the bitmap itself was never touched.
   *
   * Needs a baked picture, else an honest error (exactly like DrawMap without UseTileset).
   * The check runs against the PRE-SCANNED id rather than walk-order state, so DrawImage
   * also works inside a function — where a game's GoTitle() naturally puts it.
   */
  private genDrawImage(s: CommandStmt): void {
    const id = this.stringArg(s.args[0])
    if (!id) {
      this.err(this.M.drawImageName(), s)
      return
    }
    if (!this.bakedImageId) {
      this.err(this.M.drawImageNoImage(id), s)
      return
    }
    if (this.bakedImageId !== id) {
      this.err(this.M.drawImageOther(this.bakedImageId, id), s)
      return
    }

    const base = safeAssetName(id)
    this.emit(`/* DrawImage "${id}" */`)
    this.emit(`VIC.addr = ${hx(this.gfxMap.d018Bitmap!, 2)};`)
    this.emit(`VIC.bgcolor[0] = ${colorConst(this.imageBackground ?? 0)};`)
    this.emit(
      `{ unsigned int _i; for (_i = 0; _i < 1000; ++_i) { ` +
        `BC_SCREEN[_i] = imgscr_${base}[_i]; BC_COLOR_RAM[_i] = imgcol_${base}[_i]; } }`
    )
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
      // A map wider than the screen is a WORLD, not a picture — DrawMap would silently
      // shear it (row n would start mid-row). Say so instead (S1.B2.T1); UseMap is the
      // door for those, and it arrives with the scrolling codegen.
      if (map.width > SCREEN_W) {
        this.err(this.M.drawMapTooWide(id, map.width, SCREEN_W), s)
        return
      }
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
   * `PlayField first, last` → the strip of the screen that scrolls (S1.B3.1). Rows
   * outside it stand still while the world travels — that is where a score line lives.
   *
   * COMPILE-TIME on purpose: the band is drawn by a raster split, and the two split
   * lines are constants in the generated program. A band that could change at runtime
   * would mean rewriting the split mid-frame — so the rows must be known at build time
   * (a number, or a Const), and saying so is more honest than silently taking the first
   * value a variable happened to hold.
   */
  private genPlayField(s: CommandStmt): void {
    const first = this.constInt(s.args[0])
    const last = this.constInt(s.args[1])
    if (first === undefined || last === undefined) {
      this.err(this.M.playFieldArgs(), s)
      return
    }
    if (first < 0 || last > SCREEN_H - 1 || first > last) {
      this.err(this.M.playFieldRange(SCREEN_H), s)
      return
    }
    // The world is baked against this geometry, so moving it afterwards would describe
    // a band the level was never cut for. (Asked of the walk, not of the pre-scan — that
    // one already knows the band, which is the whole point, S1.B5.)
    if (this.useMapSeen) {
      this.err(this.M.playFieldAfterMap(), s)
      return
    }
    this.playField = { first, last }
    this.emit(`/* PlayField ${first}, ${last} — rows ${first}..${last} scroll, the rest stands */`)
  }

  /**
   * `UseMap "id"` → enter a world that may be wider than the screen (S1.B3.1). The
   * counterpart to DrawMap: that one lays down a picture, this one opens a window onto
   * a landscape you walk through.
   *
   * What gets baked (the model proven in `_preflight/scroll_t3.c` + `@shared/level-cost`):
   *   - the level COLUMN-MAJOR — a coarse scroll step reveals one column, so a column's
   *     band cells must sit next to each other. The editor stores rows; transposing is
   *     build-time work and costs the running C64 nothing.
   *   - its colours, either as a 256-byte tile→colour table (every tile keeps one
   *     colour) or per cell (the painter used the C64's per-cell freedom, so the level
   *     costs twice per column). Chosen by what was painted, never imposed.
   * The window is filled at setup; moving it is `SetCameraX`/`Follow` (S1.B3.2).
   */
  private genUseMap(s: CommandStmt): void {
    const id = this.stringArg(s.args[0])
    if (!id) {
      this.err(this.M.useMapName(), s)
      return
    }
    if (!this.assets) {
      this.err(this.M.useMapNoProject(id), s)
      return
    }
    if (!this.activeTileset) {
      this.err(this.M.useMapNoTileset(id), s)
      return
    }
    if (!this.playField) {
      this.err(this.M.useMapNoPlayField(id), s)
      return
    }
    // A SECOND world in the file — asked of the statements walked so far, not of the
    // pre-scan (which baked the first one before the walk even started, S1.B5).
    if (this.useMapSeen && this.levelWorld) {
      this.err(this.M.useMapTwice(this.levelWorld.id, id), s)
      return
    }
    this.useMapSeen = true

    // Normally the pre-scan has baked this world already. It bakes only what it can see
    // soundly (a compile-time band, a named map, a project) — everything else lands here,
    // where the error can point at the statement that meant it.
    if (!this.levelWorld && !this.bakeWorld(id, s)) return

    // Setup: show the first window, then hand the beam to the split. From here on the
    // raster interrupt owns the two $D016 writes and the KERNAL's own interrupt is off —
    // a KERNAL interrupt landing between them would put a split on the wrong line, and a
    // split on the wrong line is a visible tear.
    this.emit(`/* UseMap "${id}" */`)
    this.emit('bc_fill_window(0);')
    this.emit('VIC.ctrl2 = BC_D016_HUD;')
    this.emit('bc_split_start(); /* the raster split takes over the beam */')
  }

  /**
   * Bake the level named `id` into the program: the column-major block the engine reads,
   * plus its colours. Called from the pre-scan (before the walk, so every statement knows
   * it is in a world) or, when the pre-scan could not see far enough, from `UseMap`
   * itself. Needs `playField` — the band is what the level is cut to.
   *
   * `at` is the statement to blame for a broken map; without it (the pre-scan) a failure
   * simply leaves the world unbaked and `UseMap` reports it properly a moment later.
   * Returns whether a world now exists.
   */
  private bakeWorld(id: string, at?: Statement): boolean {
    if (!this.assets || !this.playField) return false
    let map: ResolvedTilemap
    try {
      map = resolveTilemap(id, this.assets.manifest, this.assets.readFile, this.locale)
    } catch (e) {
      if (at) this.err(e instanceof AssetResolveError ? e.message : String(e), at)
      return false
    }

    // A map is exactly one screen tall today (vertical scrolling is deferred) and
    // PlayField's rows are checked against that same screen, so the band always fits —
    // no third check that could only ever rot unused.
    const bandTop = this.playField.first
    const bandRows = this.playField.last - this.playField.first + 1

    const cost = levelCost(
      { tiles: map.tiles, colors: map.colors, width: map.width, bandTop, bandRows },
      map.height
    )

    // Column-major: for every map column, the band's tiles one after the other.
    const cells = map.width * bandRows
    const tiles = new Uint8Array(cells)
    const colors = new Uint8Array(cells)
    for (let col = 0; col < map.width; col++) {
      for (let row = 0; row < bandRows; row++) {
        const src = (bandTop + row) * map.width + col
        tiles[col * bandRows + row] = map.tiles[src]
        colors[col * bandRows + row] = (map.colors[src] & 0x0f) | 8
      }
    }

    const name = safeAssetName(id)
    // Remember where the two declarations land: `SetMapTile` changes the world, and a
    // world that can change cannot be `const`. Which of them is only known further down
    // the program, so the line is rewritten at the end (see generate()).
    this.bakedData.push(
      `/* UseMap "${id}": ${map.width} columns × ${bandRows} band rows, column-major */`
    )
    const tilesDecl = this.bakedData.length
    this.bakedData.push(
      `static const unsigned char bc_lvl_${name}[${cells}] = {`,
      byteRows(tiles),
      '};'
    )
    let colorsDecl: number
    if (cost.model === 'tileTable') {
      // Colour belongs to the TILE here: one 256-byte table instead of a byte per cell.
      // Baked with the multicolor bit already set, so the fill loop is a plain copy.
      const table = new Uint8Array(256)
      for (let t = 0; t < 256; t++) table[t] = (cost.tileColors![t] & 0x0f) | 8
      this.bakedData.push(
        `/* tile → colour (every tile keeps one colour: ${cells + 256} bytes instead of ${cells * 2}) */`
      )
      colorsDecl = this.bakedData.length
      this.bakedData.push(
        `static const unsigned char bc_lvlcol_${name}[256] = {`,
        byteRows(table),
        '};'
      )
    } else {
      this.bakedData.push(
        `/* colour per cell — tiles ${cost.conflictTiles.join(', ')} are painted in more than ` +
          `one colour, so the colour travels with the cell (${cells * 2} bytes) */`
      )
      colorsDecl = this.bakedData.length
      this.bakedData.push(
        `static const unsigned char bc_lvlcol_${name}[${cells}] = {`,
        byteRows(colors),
        '};'
      )
    }
    this.bakedData.push('')

    this.levelWorld = {
      id,
      columns: map.width,
      model: cost.model,
      bandRows,
      bytes: cost.bytes,
      tilesDecl,
      colorsDecl
    }
    return true
  }

  /**
   * May `word` speak about the world here? Two different questions, on purpose (S1.B5):
   *
   *   - INSIDE A FUNCTION the world is a PROMISE. The function is emitted before the
   *     top-level `UseMap`, but it runs after it — a game's `ResetLevel()` bringing the
   *     camera home is written above the world it moves. So it is enough that the program
   *     enters a world at all, which the pre-scan established before the walk.
   *   - AT TOP LEVEL the statement runs exactly where it stands. A camera moved before the
   *     window exists is an honest error, and it stays one — it would otherwise decide
   *     something the `UseMap` a few lines down then overwrites.
   */
  private worldSpeaks(word: string, s: Pos): boolean {
    if (!this.levelWorld) {
      this.err(this.M.cameraNoWorld(word), s)
      return false
    }
    if (!this.currentFunc && !this.useMapSeen) {
      this.err(this.M.worldNotYet(word), s)
      return false
    }
    return true
  }

  /**
   * `SetCameraX x` → put the window at world pixel x (S1.B3.2). The door to direct camera
   * control: a cut scene, a boss room, a screen shake.
   *
   * The call only decides — it runs between two VWaits, where the beam may be anywhere and
   * touching the band would tear it. The move happens at the next
   * `VWait`. Two consequences a user can feel, both honest:
   *   - moving by up to one column per frame is the smooth path (the proven coarse step);
   *   - a bigger jump is a CUT: the whole window is redrawn, which costs a frame.
   */
  private genSetCameraX(s: CommandStmt): void {
    if (!this.worldSpeaks('SetCameraX', s)) return
    if (s.args.length < 1) {
      this.err(this.M.setCameraXArgs(), s)
      return
    }
    this.usesCamera = true
    // Signed: `SetCameraX CameraX() - 2` at the left end must clamp, not wrap to the far
    // right. The cast is safe for every level that can fit in RAM (a camera beyond 32767
    // pixels would need a level ~41 KB wide, which cannot be linked into one .prg).
    this.emit(`bc_set_camx((int)(${this.expr(s.args[0])}));`)
  }

  /**
   * `SetMapTile x, y, tile[, colour]` → change the WORLD at a pixel position (S1.B3.4).
   * The counterpart to `TileAt` for a scrolling world, and the reason it exists: it
   * changes the LEVEL, not just the picture. A key picked up is gone for good — it does
   * not come back when its column scrolls out of the window and in again.
   *
   * It takes PIXELS, in the same world coordinates as `TileAt` and `Sprite`, and works
   * out the cell itself — the end of the hand-written `(px - SPR_X0) Shr 3` in ITD's
   * world.crumb. (For a standing tile world without scrolling, `SetTile` stays the one
   * that speaks cells.)
   *
   * THE COLOUR IS THE LEVEL'S OWN ANSWER. If the painting made colour a property of the
   * TILE (the cheap 256-byte table), the level has nowhere to put a per-cell colour, so
   * the cell shows that tile's colour and a colour argument is an honest warning rather
   * than a silent lie that would unravel the moment the column scrolls back in. A level
   * painted per cell stores it.
   */
  private genSetMapTile(s: CommandStmt): void {
    const world = this.levelWorld
    if (!world) {
      this.err(this.M.setMapTileNoWorld(), s)
      return
    }
    if (!this.worldSpeaks('SetMapTile', s)) return
    const a = s.args
    if (a.length < 3) {
      this.err(this.M.setMapTileArgs(), s)
      return
    }
    if (a.length >= 4 && world.model === 'tileTable') {
      this.err(this.M.setMapTileColourIsTiles(world.id), s, 'warn')
    }
    this.usesSetMapTile = true
    // The shape of the call follows the LEVEL, not the call site: a per-cell level always
    // carries a colour (0xFF = "leave the cell's colour alone"), a tile-table level never
    // does, because there is nowhere to put it.
    const args = [this.expr(a[0]), this.expr(a[1]), this.expr(a[2])]
    if (world.model === 'perCell') args.push(a.length >= 4 ? this.colorArg(a[3]) : '0xFF')
    this.emit(`bc_set_map_tile(${args.join(', ')});`)
  }

  /**
   * `Follow sprite[, threshold]` → hang the camera on a sprite (S1.B3.3). Said ONCE, not
   * every frame: from then on the world pulls itself along whenever that sprite moves.
   *
   * `threshold` is the leash — the dead zone around the middle of the window in which the
   * hero may walk without the world following. `Follow PLAYER` (no threshold) keeps him
   * dead centre; `Follow PLAYER, 20` lets him wander 20 pixels either way first, which is
   * what makes a platformer feel less like a treadmill. At the level's ends the camera
   * clamps and the hero simply walks on — that is `SetCameraX`'s doing, and it is the
   * moment a scroller becomes a level.
   */
  private genFollow(s: CommandStmt): void {
    if (!this.worldSpeaks('Follow', s)) return
    if (s.args.length < 1) {
      this.err(this.M.followArgs(), s)
      return
    }
    this.usesCamera = true
    this.noteSpriteSlot(s.args[0])
    this.emit(`bc_follow_spr = ${this.expr(s.args[0])};`)
    if (s.args.length >= 2) this.emit(`bc_follow_dead = ${this.expr(s.args[1])};`)
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
   * `AnimateTile tile, first, frames, tempo` → register an animated tile (animated-
   * charset trick). The engine swaps the stage tile's 8 charset bytes through `frames`
   * consecutive slots starting at `first`, advancing every `tempo` VWaits. Because every
   * cell showing `tile` reads the same 8 charset bytes, one copy animates them all — no
   * Screen-RAM writes. The bytes live IN the charset (BC_CHARSET), so a tileset must be
   * active (UseTileset baked it); the registry/tick helper is emitted from animTileDecls.
   */
  private genAnimateTile(s: CommandStmt): void {
    const a = s.args
    if (a.length < 4) {
      this.err(this.M.animateTileArgs(), s)
      this.emit('/* AnimateTile: zu wenige Argumente */')
      return
    }
    if (!this.activeTileset) {
      // The frames are charset bytes; without a baked charset there's nothing to cycle.
      this.err(this.M.animateTileNoTileset(), s)
      return
    }
    this.usesAnimTiles = true
    this.animTileCount++
    if (this.animTileCount === ANIM_TILE_MAX + 1) {
      // The call that tips over the table: warn once. Earlier calls stay silent, later
      // ones don't re-warn — one clear message, not a flood.
      this.err(this.M.animateTileTooMany(ANIM_TILE_MAX), s, 'warn')
    }
    const tile = this.expr(a[0])
    const first = this.expr(a[1])
    const frames = this.expr(a[2])
    const tempo = this.expr(a[3])
    this.emit(`bc_anim_add(${tile}, ${first}, ${frames}, ${tempo});`)
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
      this.noteSpriteSlot(a[0])
      this.emitSpriteEnable(a[0], this.expr(a[0]), false)
      return
    }
    if (a.length < 3) {
      this.err(this.M.spriteArgs(), s)
      this.emit('/* Sprite: zu wenige Argumente */')
      return
    }
    this.usesSprites = true
    this.noteSpriteSlot(a[0])
    const n = this.expr(a[0])
    const x = this.expr(a[1])
    const y = this.expr(a[2])
    if (this.levelWorld) {
      // In a world the position is a MAP pixel and the VIC is written in the frame's
      // tail (S1.B3.3): remember it, and let `Follow` decide the camera from it.
      this.emit(`bc_sprite(${n}, ${x}, ${y});`)
    } else {
      // Position; the 9th X bit (X >= 256) is carried into spr_hi_x bit n by hand.
      this.emit(`VIC.spr_pos[${n}].x = (unsigned char)((${x}) & 0xFF);`)
      const hiBit = this.bitOf(a[0], n)
      this.emit(`if ((${x}) & 0x100) VIC.spr_hi_x |= ${hiBit}; else VIC.spr_hi_x &= ~${hiBit};`)
      this.emit(`VIC.spr_pos[${n}].y = (${y});`)
    }
    // 4th param `frame` (SA4): bend the sprite pointer to that frame's block — one byte
    // written, no compare, no tick. Setting it every call is cheaper than a "changed?"
    // guard (Sprite is called every frame to position anyway). Frame is NOT clamped (open
    // language: the user writes `Mod`); an out-of-range frame shows a neighbour block, no
    // crash. UseSprite filled bc_spr_base[slot]; force the data defines in case a stray
    // 4-arg Sprite appears without a UseSprite (then bc_spr_base is 0 → block 0 + frame).
    if (a.length >= 4) {
      this.usesSpriteData = true
      this.usesSpriteFrames = true
      const frame = this.expr(a[3])
      // Best-effort warn: constant slot + constant frame past the slot's baked frame count.
      if (a[0].kind === 'NumberLit' && a[3].kind === 'NumberLit') {
        const slotNum = Number(a[0].raw)
        const frameNum = Number(a[3].raw)
        const count = this.spriteFrameCount.get(slotNum)
        if (count !== undefined && Number.isInteger(frameNum) && frameNum >= count) {
          this.err(this.M.spriteFrameTooHigh(slotNum, frameNum, count), s, 'warn')
        }
      }
      // In a world the shape swap is shadowed like the position: a pointer changed while
      // the beam is inside the sprite would show it half old, half new for one frame.
      this.emit(
        this.levelWorld
          ? `bc_spr_ptr[${n}] = bc_spr_base[${n}] + (${frame});`
          : `BC_SPR_PTR[${n}] = bc_spr_base[${n}] + (${frame});`
      )
    }
  }

  /** `ShowSprite n` / `HideSprite n` → flip the sprite's enable bit (VIC.spr_ena). */
  private genSpriteEnable(s: CommandStmt, on: boolean): void {
    const a = s.args
    if (a.length < 1) {
      this.err(this.M.spriteNumberRange(s.name), s)
      this.emit(`/* ${s.name}: fehlende Sprite-Nummer */`)
      return
    }
    this.noteSpriteSlot(a[0])
    this.emitSpriteEnable(a[0], this.expr(a[0]), on)
  }

  /**
   * Remember how many sprite slots the frame's tail has to serve in a world (S1.B3.3).
   * A constant slot raises the count to just past it; a slot that is only known at
   * runtime means all eight have to be considered — honest, and it costs the tail time,
   * which is the sort of thing the perf bar is for.
   */
  private noteSpriteSlot(e: Expr | undefined): void {
    if (!this.levelWorld) return
    if (e && e.kind === 'NumberLit') {
      const slot = Number(e.raw)
      if (Number.isInteger(slot) && slot >= 0 && slot < 8) {
        this.spriteSlotsUsed = Math.max(this.spriteSlotsUsed, slot + 1)
        return
      }
    }
    this.spriteSlotsUsed = 8
  }

  /**
   * The single-bit mask for slot `n` — as a shift when that costs nothing, as a table
   * lookup when it would cost a loop (TYPEN-PLAN T4).
   *
   * `1 << 3` with a CONSTANT slot is folded by cc65 into an immediate: free, and a
   * table would only make it worse (a memory read instead of a constant). But `1 << n`
   * with a slot only known at RUNTIME compiles to `aslaxy` — a 16-bit shift helper that
   * loops n times — and in a world that lands on the per-sprite, per-frame path. An
   * eight-byte table turns the whole thing into one `lda`.
   *
   * Measured, not assumed (2026-07-29, `_intern/wide-ops.test.ts`): Into The Deep's
   * `DrawBlob` goes from 5 runtime-helper calls to 3, both `aslaxy` gone, for four
   * instructions and eight bytes of table.
   *
   * @param e  the slot as written, so a `Const` counts as constant too — not just a
   *           literal. Undefined means "assume runtime" (the honest, safe side).
   * @param n  the same slot, already emitted as C.
   */
  private bitOf(e: Expr | undefined, n: string): string {
    if (e && this.constInt(e) !== undefined) return `(1 << (${n}))`
    this.usesBitTable = true
    return `bc_bit[${n}]`
  }

  /** Emit the enable-bit poke for sprite n (shared by ShowSprite/HideSprite/Sprite n,OFF).
   *  In a world it flips a WISH instead of the register: the tail decides what the VIC
   *  actually gets, because a sprite outside the window has to stay dark (S1.B3.3). */
  private emitSpriteEnable(e: Expr | undefined, n: string, on: boolean): void {
    this.usesSprites = true
    const reg = this.levelWorld ? 'bc_spr_want' : 'VIC.spr_ena'
    const bit = this.bitOf(e, n)
    if (on) this.emit(`${reg} |= ${bit};`)
    else this.emit(`${reg} &= ~${bit};`)
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
   * Colours: multicolor (from the current screen mode) sets the slot's MC bit +
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

    // Compile-time block allocator (SA2): each frame needs its own 64-byte block so the
    // hardware can pointer-swap between them; draw frames.length blocks from the shared
    // island and fail the build honestly if it would overflow (rather than the game showing
    // a neighbour's bytes at runtime). The base is recorded for SA3's slot→base table.
    const localBase = this.spriteBlockCursor
    if (localBase + frames.length > this.spriteBlockBudget) {
      const free = Math.max(0, this.spriteBlockBudget - localBase)
      this.err(this.M.spriteIslandFull(id, localBase, frames.length, free), s)
      return
    }
    this.spriteBlockCursor += frames.length

    this.usesSprites = true
    this.usesSpriteData = true
    this.noteSpriteSlot(a[0])
    const slot = this.expr(a[0])
    const dataName = `sprite_${safeAssetName(id)}`
    // Bake EVERY frame, not just frame 0 (SA3): all frames must live in RAM at once so the
    // hardware can pointer-swap between them (SA4). Flatten the frames into one array, frame
    // f at offset f*63 — the copy loop below walks it linearly.
    const stride = frame0.length // 63 bytes per frame (resolveSprite guarantees this)
    const flat = new Uint8Array(frames.length * stride)
    frames.forEach((f, i) => flat.set(f, i * stride))
    this.bakedData.push(
      `static const unsigned char ${dataName}[${flat.length}] = {`,
      byteRows(flat),
      '};'
    )

    this.emit(
      `/* UseSprite ${slot}, "${id}" — ${frames.length} frame(s) → blocks ` +
        `${localBase}..${localBase + frames.length - 1} */`
    )
    // Copy each frame into its own 64-byte block (localBase + f), walking the flat source
    // with a running pointer (no per-frame multiply). One-time setup, like the charset copy.
    this.emit(
      `{ unsigned char _f, _s; const unsigned char* _src = ${dataName}; ` +
        `for (_f = 0; _f < ${frames.length}; ++_f) { unsigned char* _d = BC_SPR_DATA(${localBase} + _f); ` +
        `for (_s = 0; _s < ${stride}; ++_s) _d[_s] = *_src++; } }`
    )
    // Record the slot's base block (frame 0) in the runtime table, so `Sprite n,x,y,frame`
    // can swap the pointer by adding `frame` (SA4); point the slot at frame 0 now.
    this.emit(`bc_spr_base[${slot}] = BC_SPR_BLOCK0 + ${localBase};`)
    // In a world the tail owns the VIC's sprite registers, so the shape has to be told to
    // the tail as well — writing only the hardware pointer here would last exactly until
    // the next frame stamped its (empty) shadow over it (S1 Schritt 2, T4b).
    if (this.levelWorld) this.emit(`bc_spr_ptr[${slot}] = bc_spr_base[${slot}];`)
    this.emit(`BC_SPR_PTR[${slot}] = bc_spr_base[${slot}];`)
    // Individual per-sprite colour (the "10" pair), chosen in the sprite editor and
    // stored in the .sprite — so player and blob can differ.
    this.emit(`VIC.spr_color[${slot}] = ${colorConst(spriteColor)};`)
    if (this.gfxColor === 'MULTICOLOR') {
      // Mark this slot multicolor + set the two SHARED registers from the project
      // palette (the coupling bgcolor1/2 = spr_mcolor0/1 — memory project-palette),
      // so sprite colours match what the editor painted.
      const pal = this.palette(s)
      this.emit(`VIC.spr_mcolor |= ${this.bitOf(a[0], slot)};`)
      this.emit(`VIC.spr_mcolor0 = ${colorConst(pal.shared1)};`)
      this.emit(`VIC.spr_mcolor1 = ${colorConst(pal.shared2)};`)
    } else {
      this.emit(`VIC.spr_mcolor &= ~${this.bitOf(a[0], slot)};`)
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
    // The SAME element, asked again: read it through the pointer this function worked out
    // once (see planRecordPointers) instead of finding the element from scratch.
    const held = this.heldPointerFor(e.base)
    if (held) return `${held}->${cName(e.field)}`
    const baseC = this.indexExpr(e.base)
    return `${baseC}.${cName(e.field)}`
  }

  /** The pointer this function already holds for `array[idx]`, if any. */
  private heldPointerFor(base: IndexExpr): string | undefined {
    if (base.indices.length !== 1) return undefined
    const idx = base.indices[0]
    if (idx.kind !== 'Identifier') return undefined
    return this.recordPtrs.get(`${base.name}#${idx.name}`)
  }

  /**
   * FIND THE ELEMENT ONCE (S1.B5.T3). `blobs[idx]\bx` is, in C, `blobs + idx × sizeof + off`
   * — and cc65 works that address out ON EVERY FIELD, through runtime helper calls. Measured
   * on the real machine: Into The Deep's `MoveBlob` makes 37 `jsr`s, twelve of them just the
   * `idx × 8`; `DrawBlob` 20 with thirteen. Three blobs cost 11.830 cycles — 60 % of a PAL
   * frame — while the whole player physics, which touches no record array, costs 3.293.
   * (memory: breadcraft-record-array-multiply-trap. The 8-byte record already spared the
   * multiply; what remained was the call, and nobody could see it from the source.)
   *
   * So: when a function reaches into the same element more than once, hold its address in a
   * pointer and read every field as a fixed offset from it. The user writes the natural
   * thing and it costs what a newcomer would assume it costs — the translation doctrine's
   * whole point, one level below the language.
   *
   * WHEN IT IS SAFE, and the rule is deliberately narrow: the index must be a plain name
   * that this function NEVER assigns (a parameter like `idx`, or a settled local). Then the
   * element cannot move under the pointer. A loop counter is excluded by exactly that test —
   * `blobs[i]` inside a `For i` loop keeps looking the element up, because it must.
   */
  private planRecordPointers(body: Statement[]): string[] {
    const uses = new Map<string, { array: string; index: string; count: number }>()
    const assigned = new Set<string>()

    const visitExpr = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const rec = node as Record<string, unknown>
      if (rec.kind === 'FieldExpr') {
        const base = rec.base as Identifier | IndexExpr
        if (base.kind === 'IndexExpr' && base.indices.length === 1) {
          const idx = base.indices[0]
          const arr = this.arrays.get(base.name)
          if (idx.kind === 'Identifier' && arr?.recordType) {
            const key = `${base.name}#${idx.name}`
            const seen = uses.get(key)
            if (seen) seen.count++
            else uses.set(key, { array: base.name, index: idx.name, count: 1 })
          }
        }
      }
      for (const key of Object.keys(rec)) {
        const v = rec[key]
        if (Array.isArray(v)) v.forEach(visitExpr)
        else if (v && typeof v === 'object') visitExpr(v)
      }
    }

    const visitStmt = (s: Statement): void => {
      // Anything that can move a name is a reason NOT to hold a pointer through it.
      if (s.kind === 'AssignStmt' && s.target.kind === 'Identifier') assigned.add(s.target.name)
      if (s.kind === 'GlobalStmt') assigned.add(s.target.name)
      if (s.kind === 'ForStmt') assigned.add(s.variable.name)
      visitExpr(s)
      const blocks: Statement[][] = []
      if (s.kind === 'IfStmt') {
        blocks.push(s.then, ...s.elifs.map((e) => e.body), s.else ?? [])
      } else if (s.kind === 'WhileStmt' || s.kind === 'RepeatStmt' || s.kind === 'ForStmt') {
        blocks.push(s.body)
      }
      for (const b of blocks) b.forEach(visitStmt)
    }
    body.forEach(visitStmt)

    const decls: string[] = []
    for (const [key, use] of uses) {
      if (use.count < 2 || assigned.has(use.index)) continue
      const arr = this.arrays.get(use.array)!
      const rec = this.records.get(arr.recordType!)
      if (!rec) continue
      const ptr = `bc_p_${cName(use.array)}_${cName(use.index)}`
      this.recordPtrs.set(key, ptr)
      decls.push(
        `register struct ${rec.cName} *${ptr} = &${arr.cName}[${cName(use.index)}];` +
          `  /* ${use.array}[${use.index}] found once, read ${use.count}× */`
      )
    }
    return decls
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
      // `For i = 10 To 0 Step -1` on a .b counter). Only a SIGNED counter can step
      // through 0 into the negatives, so its `>=` comparison terminates correctly —
      // `.s` does that just as well as `.i`, in one byte.
      if (!SIGNED_TYPES.has(counterType)) {
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
        return this.narrowByteMath(e, `(${this.expr(e.left)} ${op} ${this.expr(e.right)})`)
      }
      case 'IndexExpr':
        return this.indexExpr(e)
      case 'FieldExpr':
        return this.fieldExpr(e)
      case 'CallExpr':
        return this.callExpr(e)
    }
  }

  /**
   * TYPEN-PLAN T2 — a byte is a byte, in the generated C too.
   *
   * CRUMB's own type rule has always said `byte + byte → byte` (`exprType`), but the
   * emitted C did not say so, and C then quietly widened every such sum to `int`:
   * field 8 bits, constant 8 bits, destination 8 bits — and 16-bit arithmetic in
   * between. Writing the narrowing down (`(unsigned char)(a + b)`) makes cc65 do the
   * sum in eight bits, which is what the language claimed all along.
   *
   * ★ THIS CHANGES WHAT PROGRAMS MEAN, and that was a deliberate decision (user,
   * 2026-07-29): `200 + 100` on two `.b` values is now 44, not 300. The measurements
   * that motivated it are in `_intern/wide-ops.test.ts`; the guard rail against the
   * surprise is `checkNarrowing`, which warns when byte arithmetic is written into a
   * `.w`/`.i` destination — the one place where somebody plausibly wanted the big
   * number. Everywhere else the result was going to be truncated to eight bits anyway.
   *
   * Applied UNIFORMLY, not per context. cc65 -O already narrows some shapes by itself
   * (assignment to a byte, a byte parameter — measured in T1), so a cast there buys
   * nothing; but making the rule depend on the surroundings would mean `a + b` wraps
   * in one line and not in the next, and incoherent arithmetic is a worse price than
   * a few redundant casts in a generated file.
   */
  private narrowByteMath(e: Binary, c: string): string {
    if (!VALUE_OPS.has(e.op.toLowerCase())) return c   // a comparison is a flag, not a value
    const t = this.exprType(e)
    // `.s` is written down the same way, and it MUST be: without the cast a signed byte
    // inherits exactly the promotion that makes `.i` expensive, and the one-byte type
    // would cost the same as the two-byte one while claiming not to (TYPEN-PLAN T3).
    if (t === 'byte') return `(unsigned char)${c}`
    if (t === 'sbyte') return `(signed char)${c}`
    return c                                           // honestly wide: leave it alone
  }

  /** Is this a byte-typed CALCULATION (not just a byte value)? The warning above only
   *  fires for arithmetic — `w.w = b.b` is plain widening and holds no surprise.
   *  Both one-byte types count: each wraps at its own edge (255, or 127 into -128). */
  private isByteMath(e: Expr): boolean {
    if (e.kind === 'Grouping') return this.isByteMath(e.expr)
    if (e.kind !== 'Binary') return false
    const t = this.exprType(e)
    return VALUE_OPS.has(e.op.toLowerCase()) && (t === 'byte' || t === 'sbyte')
  }

  /**
   * Should this local live in the ZERO PAGE? (`register`, with cc65 --register-vars.)
   *
   * On cc65's software stack a SIXTEEN-BIT local costs a subroutine call per access —
   * `ldax0sp`, `stax0sp`, `addeqysp` are all `jsr`s. In the zero page the same access is
   * `lda zp / ldx zp+1`. The price is one push and one pop of the register bank per CALL,
   * which cc65 emits into the prologue; so this only pays where the saving beats that toll.
   *
   * ★ Measured, per variable, on Into The Deep (2026-07-29, harness `_intern/wide-ops.test.ts`):
   * every 16-bit local either wins or breaks even (accel −3, fric −3, acc −5, nexty −3,
   * footedge −1, front ±0), and every BYTE local is a wash (fourteen of them, all ±0 or +1).
   * The reason is structural, not accidental: a byte on the stack needs no helper call in
   * the first place, so there is nothing to remove — only the toll to pay. Hence the rule is
   * the type, not a use count. Per-frame 16-bit runtime calls in ITD: 128 → 113.
   *
   * A blanket `register` on ALL locals was measured too and is WORSE (132) — that is the
   * byte locals paying the toll for nothing.
   *
   * cc65's register bank is six bytes (`--register-space`, left at its default). Three
   * 16-bit locals fill it; anything beyond stays on the stack, which cc65 handles by itself.
   */
  private zeroPaged(type: VarType | undefined): string {
    return type === 'word' || type === 'sint' ? 'register ' : ''
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
      case 'camerax':
        // CameraX() → the window's left edge in world pixels. The counterpart to
        // SetCameraX, and what turns a world position into a screen one:
        // screen_x = world_x − CameraX() (until `Follow` does it for you, S1.B3.3).
        if (!this.worldSpeaks('CameraX', e)) return '/* CameraX: keine Welt */ 0'
        this.usesCamera = true
        return 'bc_camx'
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
/** C89/C99 reserved words + cc65/stdbool commons + the entry symbol `main`. A CRUMB
 *  variable or function named after any of these (e.g. `main`, `int`, `char`) would
 *  otherwise emit a raw C keyword and break the build with a cryptic cc65 error the
 *  target audience (no C) can't read — so cName() lifts them out of the way (B-5). */
const RESERVED_C_NAMES = new Set<string>([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
  'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long',
  'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct',
  'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while',
  '_Bool', '_Complex', '_Imaginary', 'asm',
  'bool', 'true', 'false', 'NULL', 'main'
])

function cName(name: string): string {
  // Suffix punctuation ($, .) is part of the written variable, not the C name.
  let base = name.replace(/[$]/g, '_str').replace(/[.]/g, '_')
  // A user name landing in the compiler's own `bc_`/`BC_` namespace would silently
  // clobber a generated global/macro → lift it into user space with a `v_` prefix.
  if (/^(bc_|BC_)/.test(base)) base = 'v_' + base
  // A user name equal to a C reserved word or `main` → invalid C / cryptic cc65 error.
  // A trailing underscore is enough (no keyword ends in one) and keeps the base readable
  // in the C view. Loop guards the (astronomically unlikely) crafted-collision case.
  while (RESERVED_C_NAMES.has(base)) base += '_'
  return base
}

/** A C hex literal, uppercase, zero-padded to `digits` (default 4) — e.g. hx(0x7f8) → "0x07F8". */
function hx(n: number, digits = 4): string {
  return '0x' + n.toString(16).toUpperCase().padStart(digits, '0')
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

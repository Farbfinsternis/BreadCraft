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
  ForStmt
} from '../parser/ast'
import {
  resolveCharset,
  resolveTilemap,
  AssetResolveError,
  type AssetManifest,
  type AssetReader
} from '../assets'

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

/** A BreadCraft numeric/string type, inferred from a `.b`/`.w`/`$` suffix. */
type VarType = 'byte' | 'word' | 'string'

/** The C type each BreadCraft type maps to (Sprachdef §C table). */
const C_TYPE: Record<VarType, string> = {
  byte: 'unsigned char',
  word: 'unsigned int',
  string: 'char' // emitted as `char name[…]` — buffer sizing is a later (string) layer
}

/** Read the BreadCraft type from an identifier's written suffix. */
function suffixType(suffix: string | undefined): VarType | undefined {
  switch (suffix) {
    case '.b':
      return 'byte'
    case '.w':
      return 'word'
    case '$':
      return 'string'
    default:
      return undefined
  }
}

/**
 * The record type name in a suffix like `.Slot`, or undefined for a scalar suffix
 * (`.b`/`.w`/`$`) or none. The lexer only attaches `.Name` when Name is a known
 * record, so any `.x` that isn't a scalar suffix is a record type.
 */
function recordSuffixName(suffix: string | undefined): string | undefined {
  if (!suffix || suffix === '$' || suffix === '.b' || suffix === '.w') return undefined
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
  /** TileSolid used → bake the default solid table + the pixel→cell→solid helper. */
  private usesTileSolid = false
  /** TileAt used → emit the pixel→cell→tile helper. */
  private usesTileAt = false

  constructor(private readonly assets?: AssetContext) {}

  private emit(line: string): void {
    this.lines.push('  '.repeat(this.indent) + line)
  }

  private err(message: string, at: Pos, severity: Severity = 'error'): void {
    this.errors.push({ message, line: at.line, col: at.col, severity })
  }

  generate(program: Program): CodeGenResult {
    // First pass: collect declarations (types, globals, consts) so the second pass
    // can emit correctly-typed declarations and narrowing checks.
    for (const s of program.body) this.collect(s)

    for (const s of program.body) this.genStatement(s)

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
      header.push('#define BC_CHARSET ((unsigned char*)0x3000) /* our tileset */')
    }
    if (this.activeTileset || this.usesTileWorld) {
      header.push(
        '#define BC_SCREEN  ((unsigned char*)0x0400) /* tile-number grid (40x25) */',
        '#define BC_SCR_W   40',
        // VIC sprite coordinate origin of the top-left visible cell (the pixel→cell
        // offset, _preflight/tilecollide.c) — used by TileAt/TileSolid.
        '#define BC_SPR_X0  24',
        '#define BC_SPR_Y0  50',
        ''
      )
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
        structDecls.push(`  ${C_TYPE[ftype]} ${cName(fname)}${ftype === 'string' ? '[1]' : ''};`)
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
      const decl = `${C_TYPE[sym.type]} ${sym.cName}${sym.type === 'string' ? '[1]' : ' = 0'};`
      if (sym.global) globalDecls.push(decl)
      else localDecls.push('  ' + decl)
    }
    if (globalDecls.length > 0) globalDecls.push('')
    if (localDecls.length > 0) localDecls.push('')

    // Baked asset data (charset bytes, map tiles) — file scope, like Dim arrays.
    const baked = this.bakedData.length > 0 ? [...this.bakedData, ''] : []

    // Tile-world file-scope data + helpers (M3.T1), emitted only when used.
    const tileWorld = this.tileWorldDecls()

    const code = [
      ...header,
      ...defines,
      ...structDecls,
      ...arrayDecls,
      ...baked,
      ...tileWorld,
      ...globalDecls,
      'int main(void) {',
      ...localDecls,
      ...this.lines,
      '',
      '  return 0;',
      '}',
      ''
    ].join('\n')
    return { code, errors: this.errors }
  }

  /**
   * File-scope declarations for the tile-world primitives (M3.T1), emitted only for
   * what the program actually uses. Mirrors _preflight/tilecollide.c:
   *   - BC_DATA[]: the invisible data layer GetTile(…,1) reads. No editor paints it
   *     yet (the META-layer is a later milestone), so it's all-zero = "nothing
   *     beneath" — the latent-object pattern stays writable and compiles today.
   *   - bc_tile_solid[]: default solidity (tile 0 passable, the rest solid) until a
   *     per-tile solid attribute exists in the tileset editor.
   *   - bc_tile_at / bc_tile_solid_at: the pixel→cell→tile(/solid) helpers, so
   *     TileAt/TileSolid are plain C expressions.
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
    if (this.usesTileAt || this.usesTileSolid) {
      out.push(
        '/* pixel position → tile number at that cell (0 outside the field) */',
        'static unsigned char bc_tile_at(unsigned int px, unsigned char py) {',
        '  unsigned char col, row;',
        '  if (px < BC_SPR_X0 || py < BC_SPR_Y0) return 0;',
        '  col = (unsigned char)((px - BC_SPR_X0) >> 3);',
        '  row = (unsigned char)((py - BC_SPR_Y0) >> 3);',
        '  if (col >= BC_SCR_W || row >= 25) return 0;',
        '  return BC_SCREEN[row * BC_SCR_W + col];',
        '}',
        ''
      )
    }
    if (this.usesTileSolid) {
      out.push(
        '/* default solidity: tile 0 = empty/passable, every other tile = solid */',
        'static unsigned char bc_tile_solid_at(unsigned int px, unsigned char py) {',
        '  return bc_tile_at(px, py) != 0;',
        '}',
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
        if (s.target.kind === 'Identifier') this.declare(s.target)
        break
      case 'GlobalStmt':
        this.declare(s.target, { global: true })
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

  /** The inferred type of an expression, as far as the slice can tell (§D). */
  private exprType(e: Expr): VarType | undefined {
    switch (e.kind) {
      case 'StringLit':
        return 'string'
      case 'Identifier':
        return this.symbols.get(e.name)?.type
      case 'IndexExpr':
        return this.arrays.get(e.name)?.type
      case 'FieldExpr':
        return this.recordOf(e.base)?.fields.get(e.field)
      case 'Grouping':
        return this.exprType(e.expr)
      case 'Binary': {
        // .b + .w → .w (no implicit float; widening, §D). Word is contagious.
        const l = this.exprType(e.left)
        const r = this.exprType(e.right)
        if (l === 'word' || r === 'word') return 'word'
        if (l === 'byte' || r === 'byte') return 'byte'
        return undefined
      }
      default:
        // Number literals and unknown calls: type follows the assignment target.
        return undefined
    }
  }

  /**
   * Warn when a word value is stored into a byte target — data would be truncated
   * (Sprachdef §C.1). Widening (.b → .w) is silent. Unknown source types don't warn.
   * Works for a scalar variable, an array element, or a record field (same rule).
   */
  private checkNarrowing(target: Identifier | IndexExpr | FieldExpr, value: Expr): void {
    if (this.exprType(target) !== 'byte') return
    if (this.exprType(value) === 'word') {
      const where =
        target.kind === 'Identifier'
          ? `die Byte-Variable '${target.name}'`
          : target.kind === 'IndexExpr'
            ? `das Byte-Array-Element '${target.name}[…]'`
            : `das Byte-Feld '\\${target.field}'`
      this.err(
        `Verkleinerung: ein .w-Wert (0…65535) wird in ${where} (.b, 0…255) geschrieben — höhere Bits gehen verloren`,
        target,
        'warn'
      )
    }
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
        this.emit(`${cName(s.target.name)} = ${this.expr(s.value)};`)
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
      case 'bordercolor':
        this.emit(`bordercolor(${this.colorArg(a[0])});`)
        break
      case 'cls':
        this.emit(`bgcolor(${this.colorArg(a[0])});`)
        this.emit('clrscr();')
        break
      case 'drawtext':
        // DrawText x, y, expr → cputsxy(x, y, expr)
        if (a.length >= 3) {
          this.emit(`cputsxy(${this.expr(a[0])}, ${this.expr(a[1])}, ${this.expr(a[2])});`)
        } else {
          this.err('DrawText erwartet x, y, Ausdruck', s)
          this.emit('/* DrawText: zu wenige Argumente */')
        }
        break
      default:
        this.err(`Befehl '${s.name}' hat in diesem Schritt noch kein C-Mapping`, s)
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
      this.err("Graphics: erstes Argument muss TEXT oder BITMAP sein", s)
      return
    }
    if (color !== 'HIRES' && color !== 'MULTICOLOR') {
      this.err("Graphics: zweites Argument muss HIRES oder MULTICOLOR sein", s)
      return
    }
    // Phase-1 forbids BITMAP,HIRES (Sprachdef §E lists only the three valid combos).
    if (area === 'BITMAP' && color === 'HIRES') {
      this.err('Graphics BITMAP, HIRES ist in Phase 1 nicht vorgesehen (nur TEXT,HIRES | TEXT,MULTICOLOR | BITMAP,MULTICOLOR)', s)
      return
    }
    this.gfxArea = area
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
      this.err('UseTileset erwartet einen Tileset-Namen in Anführungszeichen, z. B. UseTileset "main"', s)
      return
    }
    if (!this.assets) {
      this.err(`UseTileset "${id}": kein Projekt-Kontext — Assets können nur in einem Projekt aufgelöst werden`, s)
      return
    }
    let bytes: Uint8Array
    try {
      bytes = resolveCharset(id, this.assets.manifest, this.assets.readFile).bytes
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
    // MC-text shared colours (the "00/01/10" pairs); the "11" pair is per-cell Color-RAM.
    this.emit('VIC.bgcolor[0] = COLOR_BLACK;')
    this.emit('VIC.bgcolor[1] = COLOR_BROWN;')
    this.emit('VIC.bgcolor[2] = COLOR_ORANGE;')
  }

  /**
   * `DrawMap "id"` → bake the painted 40×25 tile numbers and copy them into screen
   * RAM, so the VIC draws the map for free (proven _preflight/tilemap.c Z.103–119).
   * Needs an active tileset (the chars to draw) — otherwise an honest error.
   */
  private genDrawMap(s: CommandStmt): void {
    const id = this.stringArg(s.args[0])
    if (!id) {
      this.err('DrawMap erwartet einen Karten-Namen in Anführungszeichen, z. B. DrawMap "level1"', s)
      return
    }
    if (!this.assets) {
      this.err(`DrawMap "${id}": kein Projekt-Kontext — Karten können nur in einem Projekt aufgelöst werden`, s)
      return
    }
    if (!this.activeTileset) {
      this.err(`DrawMap "${id}": kein Tileset aktiv — vorher UseTileset "…" aufrufen`, s)
      return
    }
    let tiles: Uint8Array
    try {
      tiles = resolveTilemap(id, this.assets.manifest, this.assets.readFile).tiles
    } catch (e) {
      this.err(e instanceof AssetResolveError ? e.message : String(e), s)
      return
    }

    const cName = `map_${safeAssetName(id)}`
    this.bakedData.push(
      `static const unsigned char ${cName}[${tiles.length}] = {`,
      byteRows(tiles),
      '};'
    )

    this.emit(`/* DrawMap "${id}" */`)
    // Copy tile numbers to screen RAM; give every cell a multicolor per-cell colour
    // (bit 3 set = multicolor in MC-text). A fixed light grey for now — per-cell colour
    // arrives with MetaTiles (TILEMAP_EDITOR.md).
    this.emit(
      `{ unsigned int _c; for (_c = 0; _c < ${tiles.length}; ++_c) { BC_SCREEN[_c] = ${cName}[_c]; COLOR_RAM[_c] = COLOR_GRAY1 | 8; } }`
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
      this.err('SetTile erwartet spalte, zeile, tile, farbe', s)
      this.emit('/* SetTile: zu wenige Argumente */')
      return
    }
    this.usesTileWorld = true
    const col = this.expr(a[0])
    const row = this.expr(a[1])
    const tile = this.expr(a[2])
    const color = this.colorArg(a[3])
    const off = `(${row}) * BC_SCR_W + (${col})`
    this.emit(`BC_SCREEN[${off}] = ${tile};`)
    this.emit(`COLOR_RAM[${off}] = (${color}) | 8;`)
  }

  private genAssign(s: AssignStmt): void {
    this.checkNarrowing(s.target, s.value)
    this.emit(`${this.lvalue(s.target)} = ${this.expr(s.value)};`)
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
      this.err(`Unbekanntes Array '${e.name}' — fehlt ein 'Dim ${e.name}…'?`, e)
      return `/* TODO: ${e.name}[] nicht deklariert */ 0`
    }
    if (e.indices.length === 2) {
      // 2D → flat: zeile * breite + spalte (spalte = first index, zeile = second).
      const width = this.expr(arr.sizes[0])
      const spalte = this.expr(e.indices[0])
      const zeile = this.expr(e.indices[1])
      return `${arr.cName}[(${zeile}) * (${width}) + (${spalte})]`
    }
    if (e.indices.length === 1) {
      return `${arr.cName}[${this.expr(e.indices[0])}]`
    }
    this.err(`Array '${e.name}' erwartet 1 oder 2 Indizes`, e)
    return `${arr.cName}[0]`
  }

  /** Render a record field access `tasche[3]\count` / `p\x` → `base.count` (§C). */
  private fieldExpr(e: FieldExpr): string {
    const rec = this.recordOf(e.base)
    if (rec && !rec.fields.has(e.field)) {
      this.err(`Record '${rec.cName}' hat kein Feld '${e.field}'`, e)
    }
    const baseC = e.base.kind === 'Identifier' ? cName(e.base.name) : this.indexExpr(e.base)
    return `${baseC}.${cName(e.field)}`
  }

  /** The record type backing a field-access base (an array element or scalar). */
  private recordOf(base: Identifier | IndexExpr): RecordInfo | undefined {
    if (base.kind === 'IndexExpr') {
      const arr = this.arrays.get(base.name)
      if (arr?.recordType) return this.records.get(arr.recordType)
    }
    // Scalar record variables (Global p.Slot) are a later layer; arrays cover §C's example.
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
          'Frame-Schleife (While 1) ohne VWait: ohne Frame-Sync läuft die Schleife so ' +
            'schnell wie möglich (Bewegung rast davon, Tearing). Setz ein VWait in die Schleife.',
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

  private genFor(s: ForStmt): void {
    const v = cName(s.variable.name)
    const step = s.step ? this.expr(s.step) : '1'
    this.emit(`for (${v} = ${this.expr(s.from)}; ${v} <= ${this.expr(s.to)}; ${v} += ${step}) {`)
    this.genBlock(s.body)
    this.emit('}')
  }

  // ---- expressions ----

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
        return cName(e.name)
      case 'Grouping':
        return `(${this.expr(e.expr)})`
      case 'Unary': {
        const op = OP_C[e.op.toLowerCase()] ?? e.op
        return `${op}${this.expr(e.expr)}`
      }
      case 'Binary': {
        const op = OP_C[e.op.toLowerCase()] ?? e.op
        return `${this.expr(e.left)} ${op} ${this.expr(e.right)}`
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
          this.err('GetTile erwartet spalte, zeile [, layer]', e)
          return '/* GetTile: zu wenige Argumente */ 0'
        }
        this.usesTileWorld = true
        const off = `(${this.expr(a[1])}) * BC_SCR_W + (${this.expr(a[0])})`
        const layer = a.length >= 3 ? this.constLayer(a[2]) : 0
        if (layer === 1) {
          this.usesDataLayer = true
          return `BC_DATA[${off}]`
        }
        return `BC_SCREEN[${off}]`
      }
      case 'tileat':
        if (a.length < 2) {
          this.err('TileAt erwartet px, py', e)
          return '/* TileAt: zu wenige Argumente */ 0'
        }
        this.usesTileWorld = true
        this.usesTileAt = true
        return `bc_tile_at(${this.expr(a[0])}, ${this.expr(a[1])})`
      case 'tilesolid':
        if (a.length < 2) {
          this.err('TileSolid erwartet px, py', e)
          return '/* TileSolid: zu wenige Argumente */ 0'
        }
        this.usesTileWorld = true
        this.usesTileSolid = true
        this.usesTileAt = true // bc_tile_solid_at builds on bc_tile_at
        return `bc_tile_solid_at(${this.expr(a[0])}, ${this.expr(a[1])})`
      default:
        this.err(`Funktion '${e.callee}' hat in diesem Schritt noch kein C-Mapping`, e)
        return `/* TODO ${e.callee}() */ 0`
    }
  }

  /** Read a literal layer index (0/1) from a GetTile layer arg; non-literal → 0 with
   *  an honest note (the data layer is a compile-time choice in Phase 1). */
  private constLayer(e: Expr): number {
    if (e.kind === 'NumberLit' && e.base === 'dec') return e.raw === '1' ? 1 : 0
    this.err('GetTile: layer muss 0 oder 1 sein (fester Wert)', e)
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
export function generate(program: Program, assets?: AssetContext): CodeGenResult {
  return new Generator(assets).generate(program)
}

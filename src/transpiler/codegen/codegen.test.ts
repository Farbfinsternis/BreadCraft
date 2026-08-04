import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile, tokenize, parse, generate } from '../index'
import type { AssetContext } from '../codegen'
import { INLINE_MAX_STMTS } from './inline'

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

/** What the CODEGEN reports about a program besides its C (S1.B4): the engine's cost facts
 *  and the baked level's bytes. They sit on the codegen result rather than the compile
 *  front door, because their only consumers are the health bars downstream. */
function genFacts(src: string, assets?: AssetContext): ReturnType<typeof generate> {
  return generate(parse(tokenize(src, vocab), vocab).program, assets)
}

function gen(
  src: string,
  assets?: AssetContext
): {
  code: string
  errors: string[]
  warnings: string[]
} {
  const { code, errors } = compile(src, vocab, assets)
  const fmt = (e: (typeof errors)[number]): string => `${e.stage} ${e.line}:${e.col} ${e.message}`
  return {
    code,
    errors: errors.filter((e) => e.severity === 'error').map(fmt),
    warnings: errors.filter((e) => e.severity === 'warn').map(fmt)
  }
}

/** A fake asset context: one charset ("main"), one tilemap ("level1"), one sprite
 *  ("player"), in memory. */
function fakeAssets(): AssetContext {
  const charset = JSON.stringify({
    format: 'breadcraft.petscii',
    charCount: 256,
    chars: Array.from({ length: 256 }, (_, i) =>
      i === 1 ? [1, 2, 3, 4, 5, 6, 7, 8] : [0, 0, 0, 0, 0, 0, 0, 0]
    )
  })
  const tilemap = JSON.stringify({
    format: 'breadcraft.tilemap',
    layers: [
      {
        type: 'grafik',
        tiles: Array.from({ length: 1000 }, (_, i) => (i === 0 ? 1 : 0)),
        // Cell 0 painted red (2); the rest light grey (15) — proves the painted
        // per-cell Color-RAM reaches the bake.
        colors: Array.from({ length: 1000 }, (_, i) => (i === 0 ? 2 : 15))
      }
    ]
  })
  // A level three screens wide (S1.B2.T1) — a WORLD, not a picture. DrawMap must say so
  // instead of shearing it onto one screen; UseMap walks through it (S1.B3.1). Every
  // tile keeps one colour, so it buys the cheap tile→colour table.
  const W = 120
  const wideMap = JSON.stringify({
    format: 'breadcraft.tilemap',
    width: W,
    height: 25,
    layers: [
      {
        type: 'grafik',
        tiles: Array.from({ length: W * 25 }, (_, i) => 70 + (Math.floor(i / W) % 3)),
        colors: Array.from({ length: W * 25 }, (_, i) => 2 + (Math.floor(i / W) % 3))
      }
    ]
  })
  // The same size, but tile 80 is painted in two colours — the level then pays its
  // colours per cell (@shared/level-cost).
  const mottledMap = JSON.stringify({
    format: 'breadcraft.tilemap',
    width: W,
    height: 25,
    layers: [
      {
        type: 'grafik',
        tiles: Array.from({ length: W * 25 }, () => 80),
        colors: Array.from({ length: W * 25 }, (_, i) => (i === 5 * W + 7 ? 7 : 1))
      }
    ]
  })
  // Two frames so a test can confirm UseSprite bakes ONLY frame 0.
  const sprite = JSON.stringify({
    format: 'breadcraft.sprite',
    frames: [
      Array.from({ length: 63 }, (_, i) => (i === 0 ? 0xff : i === 62 ? 0x42 : 0)),
      Array.from({ length: 63 }, () => 0x99)
    ]
  })
  // Two pictures, so a test can confirm the honest one-picture-per-program error (B2.T3).
  // Position-coded first bytes make a misplaced bake visible.
  const image = (first: number, bg: number): string =>
    JSON.stringify({
      format: 'breadcraft.image',
      version: 1,
      background: bg,
      bitmap: Array.from({ length: 8000 }, (_, i) => (i === 0 ? first : 0)),
      screen: Array.from({ length: 1000 }, (_, i) => (i === 0 ? 0x12 : 0)),
      color: Array.from({ length: 1000 }, (_, i) => (i === 0 ? 0x03 : 0))
    })
  const files: Record<string, string> = {
    'main.petscii': charset,
    'level1.tilemap': tilemap,
    'welt.tilemap': wideMap,
    'welt2.tilemap': wideMap,
    'bunt.tilemap': mottledMap,
    'player.sprite': sprite,
    'titel.image': image(0xaa, 6),
    'raum2.image': image(0xbb, 0)
  }
  return {
    manifest: {
      palette: null,
      charsets: ['main.petscii'],
      tilemaps: ['level1.tilemap', 'welt.tilemap', 'welt2.tilemap', 'bunt.tilemap'],
      sprites: ['player.sprite'],
      images: ['titel.image', 'raum2.image']
    },
    readFile: (rel: string) => (rel in files ? files[rel] : null)
  }
}

describe('codegen: program frame', () => {
  it('emits the conio/c64 header and a main() function', () => {
    const { code, errors } = gen('SetMode TEXT')
    expect(errors).toEqual([])
    expect(code).toContain('#include <conio.h>')
    expect(code).toContain('#include <cbm.h>')
    expect(code).toContain('int main(void) {')
    expect(code).toContain('return 0;')
  })
})

describe('codegen: setup commands → conio', () => {
  it('maps BorderColor / Cls / DrawText with color macros', () => {
    const src = ['SetMode TEXT', 'BorderColor BLACK', 'Cls BLUE', 'DrawText 0, 0, "HI"'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('bordercolor(COLOR_BLACK);')
    expect(code).toContain('bgcolor(COLOR_BLUE);')
    expect(code).toContain('clrscr();')
    // DrawText writes C64 screen codes straight to Screen-RAM (not conio cputsxy, which
    // writes PETSCII and mis-indexes a custom charset — proven in VICE 2026-06-16).
    expect(code).toContain('bc_drawtext(0, 0, "HI", bc_pen);')
    expect(code).toContain('static void bc_drawtext(')
    expect(code).not.toContain('cputsxy')
  })

  it('Color sets the pen; text is HIRES (bit 3 clear, full nibble) in BOTH modes — Mixed-Mode', () => {
    // C64 Mixed-Mode (MIXED_MODE_FONT_PLAN F1): text cells leave bit 3 CLEAR so the VIC
    // draws crisp 8px glyphs even in a MULTICOLOR-text project (tiles set bit 3 themselves).
    const hires = gen(['SetMode TEXT, HIRES', 'Color WHITE', 'DrawText 0, 0, "HI"'].join('\n'))
    expect(hires.errors).toEqual([])
    expect(hires.code).toContain('bc_pen = (COLOR_WHITE);')

    const mc = gen(['SetMode TEXT, MULTICOLOR', 'Color YELLOW', 'DrawText 0, 0, "HI"'].join('\n'))
    expect(mc.errors).toEqual([])
    expect(mc.code).toContain('bc_pen = (COLOR_YELLOW);')
    expect(mc.code).not.toContain('| 8') // text must NOT be folded into multicolor
  })

  it('Color without a colour fails honestly', () => {
    expect(gen('Color').errors.some((e) => /Color erwartet/.test(e))).toBe(true)
  })
})

describe('codegen: control flow', () => {
  it('turns the frame loop While 1 … Wend into for(;;) — VWait is written by the user', () => {
    const { code, warnings } = gen('While 1\n  VWait\n  DrawText 0, 0, "x"\nWend')
    expect(code).toContain('for (;;) {')
    expect(code).toContain('waitvsync();') // from the explicit VWait, not auto-inserted
    expect(warnings).toEqual([]) // VWait present → no frame-sync warning
  })

  it('warns when a While 1 frame loop has no VWait', () => {
    const { warnings } = gen('While 1\n  DrawText 0, 0, "x"\nWend')
    expect(warnings.some((w) => /VWait/.test(w))).toBe(true)
  })

  it('maps a non-constant While to a while loop (no frame-sync warning)', () => {
    const { code, warnings } = gen('While running\n  DrawText 0, 0, "x"\nWend')
    expect(code).toContain('while (running) {')
    expect(warnings).toEqual([]) // only the `While 1` frame loop warns
  })

  it('maps If/ElseIf/Else and single-line If…Then', () => {
    const block = gen('If x > 10\n  DrawText 0,0,"a"\nElse\n  DrawText 0,0,"b"\nEndIf').code
    expect(block).toContain('if ((x > 10)) {') // M1.T1: expr() always parenthesizes (Befund 1)
    expect(block).toContain('} else {')

    const oneLine = gen('If x > 10 Then DrawText 0,0,"a"').code
    expect(oneLine).toContain('if ((x > 10)) {')
  })

  it('maps For … To … [Step] to a C for loop', () => {
    expect(gen('For i = 0 To 9\nNext').code).toContain('for (i = 0; i <= 9; i += 1) {')
    expect(gen('For i = 0 To 10 Step 2\nNext').code).toContain('i += 2')
  })

  it('maps Repeat … Until to a do/while and Exit to break', () => {
    const { code } = gen('Repeat\n  Exit\nUntil done')
    expect(code).toContain('do {')
    expect(code).toContain('break;')
    expect(code).toContain('} while (!(done));')
  })
})

describe('codegen: 2D index strength reduction (STAHL S2b)', () => {
  const read2d = (dim: string, extra = '') =>
    gen(`${dim}\nGlobal r.b = 0\nGlobal c.b = 0\nGlobal x.b = 0\n${extra}x = feld[c, r]`).code

  it('non-power-of-2 width 40 → shift/add chain (32+8), no multiply', () => {
    // 40 = (r<<5)+(r<<3) — cc65 would otherwise call its software multiply (verified).
    expect(read2d('Dim feld.b[40, 25]')).toContain('feld[(((r) << 5) + ((r) << 3)) + (c)]')
  })

  it('power-of-2 width 32 → a single shift', () => {
    expect(read2d('Dim feld.b[32, 25]')).toContain('feld[((r) << 5) + (c)]')
  })

  it('a Const width is resolved and specialized like a literal', () => {
    expect(read2d('Const W = 40\nDim feld.b[W, 25]')).toContain('feld[(((r) << 5) + ((r) << 3)) + (c)]')
  })

  it('a width with too many set bits (30) stays a multiply (chain would be worse)', () => {
    expect(read2d('Dim feld.b[30, 25]')).toContain('(r) * (30)')
  })

  it('a non-trivial row expression stays a multiply (never evaluated twice)', () => {
    // The row is `r + 1` (a Binary): duplicating it could re-run side effects, so keep `*`.
    const code = gen('Dim feld.b[40, 25]\nGlobal r.b = 0\nGlobal c.b = 0\nGlobal x.b = 0\nx = feld[c, r + 1]').code
    expect(code).toContain('* (40)')
    expect(code).not.toContain('<< 5')
  })
})

describe('codegen: For loop direction & bounds (M1.T2, Befund 3)', () => {
  it('keeps the plain upward loop unchanged (the common case)', () => {
    expect(gen('For i = 0 To 9\nNext').code).toContain('for (i = 0; i <= 9; i += 1) {')
    expect(gen('For i = 0 To 10 Step 2\nNext').code).toContain('for (i = 0; i <= 10; i += 2) {')
  })

  it('a constant negative Step counts down with >= and -= |step| (needs .i)', () => {
    const { code, errors } = gen('For i.i = 10 To 1 Step -1\nNext')
    expect(errors).toEqual([])
    expect(code).toContain('for (i = 10; i >= 1; i -= 1) {')
  })

  it('.i counter may count down to 0 safely (the N5 case, fixed by signedness)', () => {
    const { code, errors } = gen('For i.i = 10 To 0 Step -1\nNext')
    expect(errors).toEqual([])
    expect(code).toContain('for (i = 10; i >= 0; i -= 1) {')
  })

  it('counting down on an UNSIGNED counter is an honest error, not a silent infinite loop', () => {
    // 10 To 1 never reaches 0, but the rule is uniform: downward needs .i.
    const e1 = gen('For i = 10 To 1 Step -1\nNext').errors
    expect(e1.some((e) => /Abwärts zählen .*\.i/.test(e))).toBe(true)
  })

  it('N5: For i = 10 To 0 Step -1 on a .b counter errors instead of wrapping past 0', () => {
    const { errors } = gen('For i = 10 To 0 Step -1\nNext')
    expect(errors.some((e) => /Abwärts zählen .*unter null/.test(e))).toBe(true)
  })

  it('255-trap: For i = 0 To 255 on a .b counter errors and points at .w', () => {
    const { errors } = gen('For i = 0 To 255\nNext')
    expect(errors.some((e) => /255 \(Byte-Maximum\).*nimm \.w/.test(e))).toBe(true)
  })

  it('a wider counter clears the 255-trap (0 To 255 on .w is fine)', () => {
    const { code, errors } = gen('For i.w = 0 To 255\nNext')
    expect(errors).toEqual([])
    expect(code).toContain('for (i = 0; i <= 255; i += 1) {')
  })

  it('Step 0 is caught as an endless loop', () => {
    expect(gen('For i = 0 To 9 Step 0\nNext').errors.some((e) => /Step 0.*endlos/.test(e))).toBe(true)
  })
})

describe('codegen: expressions', () => {
  it('respects precedence and maps operators', () => {
    const { code } = gen('score.w = 10 + 5 * 2')
    // M1.T1: expr() always parenthesizes → the CRUMB tree `10 + (5*2)` prints faithfully.
    expect(code).toContain('score = (10 + (5 * 2));')
  })

  it('M1.T1 (Befund 1): preserves CRUMB precedence where it differs from C', () => {
    // These three are the regression net for Befund 1. CRUMB binds Shl/Shr/Xor like
    // `*` (tighter than +) and treats And/Or at the same low level (left-assoc) — all
    // of which C orders differently. Without the always-parens fix, the bare C would
    // be silently re-bound by C's precedence and compute the WRONG result.
    const src = ['Global a.w = 1', 'Global b.w = 2', 'Global c.w = 3', 'a = a + b Shl 2', 'a = a Or b And c', 'a = a Xor b + c'].join('\n')
    const { code } = gen(src)
    expect(code).toContain('a = (a + (b << 2));') // Shl tighter than + (bare C: (a+b)<<2)
    expect(code).toContain('a = ((a || b) && c);') // Or/And same level, left (bare C: a||(b&&c))
    expect(code).toContain('a = ((a ^ b) + c);') // Xor tighter than + (bare C: a^(b+c))
  })

  it('declares suffix-less variables as byte (the cheap default, §C)', () => {
    const { code } = gen('x = 1\ny = 2')
    expect(code).toContain('unsigned char x = 0;')
    expect(code).toContain('unsigned char y = 0;')
  })

  it('emits hex and binary literals', () => {
    expect(gen('x = $FF').code).toContain('0xFF')
    expect(gen('x = %1010').code).toContain('0b1010')
  })

  it('B-5: renames variables that collide with C keywords / main (no cryptic cc65 error)', () => {
    const { code, errors } = gen('int = 1\nchar = 2\nmain = 3')
    expect(errors).toEqual([])
    // None of the reserved words may leak as a bare C identifier.
    expect(code).toContain('unsigned char int_ = 0;')
    expect(code).toContain('unsigned char char_ = 0;')
    expect(code).toContain('unsigned char main_ = 0;')
    expect(code).not.toMatch(/unsigned char (int|char|main) =/)
  })

  it('B-5: lifts a variable out of the compiler bc_/BC_ namespace', () => {
    const { code } = gen('bc_pen = 1')
    expect(code).toContain('unsigned char v_bc_pen = 0;')
    expect(code).not.toMatch(/unsigned char bc_pen =/)
  })
})

describe('codegen: type system (Sprachdef §C)', () => {
  it('maps .b → unsigned char and .w → unsigned int from the written suffix', () => {
    const { code } = gen('leben.b = 3\npunkte.w = 1000')
    expect(code).toContain('unsigned char leben = 0;')
    expect(code).toContain('unsigned int punkte = 0;')
  })

  it('infers the type from the first suffix, even if later uses omit it', () => {
    // punkte is declared .w once; a later bare `punkte = …` must not downgrade it.
    const { code } = gen('punkte.w = 1\npunkte = 2')
    expect(code).toContain('unsigned int punkte = 0;')
    expect(code).not.toContain('unsigned char punkte')
  })

  it('declares the For counter (byte by default)', () => {
    const { code } = gen('For i = 0 To 9\nNext')
    expect(code).toContain('unsigned char i = 0;')
  })
})

describe('codegen: Global (file scope, §C)', () => {
  it('declares a Global before main and emits its mandatory init inside main', () => {
    const { code } = gen('Global score.w = 0\nscore = score + 1')
    const mainAt = code.indexOf('int main(void) {')
    const declAt = code.indexOf('unsigned int score = 0;')
    expect(declAt).toBeGreaterThanOrEqual(0)
    expect(declAt).toBeLessThan(mainAt) // declared at file scope, before main
    expect(code).toContain('score = 0;') // the init runs in main
  })
})

describe('codegen: Const (§C)', () => {
  it('turns Const into a #define and emits nothing in the body', () => {
    const { code, errors } = gen('Const MAXLIVES = 3')
    expect(errors).toEqual([])
    expect(code).toContain('#define MAXLIVES (3)')
  })

  it('lets a Const be used in an expression', () => {
    const { code } = gen('Const MAXLIVES = 3\nleben.b = MAXLIVES')
    expect(code).toContain('#define MAXLIVES (3)')
    expect(code).toContain('leben = MAXLIVES;')
  })

  it('accepts a Const whose name only case-folds to an SSOT word (case-sensitive, M2.T2)', () => {
    // MAX ≠ the canonical `Max`, so it is a free name and compiles cleanly through
    // lex → parse → codegen. (The exact canonical `LEFT` would be reserved — see the
    // parser reserved-word tests.)
    const { code, errors } = gen('Const MAX = 5')
    expect(errors).toEqual([])
    expect(code).toContain('#define MAX (5)')
  })
})

describe('codegen: narrowing warning (.w → .b, §C.1)', () => {
  it('warns when a word variable is stored into a byte variable', () => {
    const { warnings, errors, code } = gen('gross.w = 1000\nklein.b = gross')
    expect(errors).toEqual([]) // a warning, not an error — the build still runs
    expect(warnings.some((w) => /Verkleinerung/.test(w))).toBe(true)
    expect(code).toContain('klein = gross;') // code still emitted (silent wrap at runtime)
  })

  it('does NOT warn on widening (.b → .w)', () => {
    const { warnings } = gen('klein.b = 5\ngross.w = klein')
    expect(warnings).toEqual([])
  })

  it('treats a word-contagious expression (.b + .w) as word', () => {
    const { warnings } = gen('a.b = 1\nb.w = 2\nc.b = a + b')
    expect(warnings.some((w) => /Verkleinerung/.test(w))).toBe(true)
  })
})

describe('codegen: Dim arrays (§C)', () => {
  it('declares a 1D array at file scope with its element type', () => {
    const { code } = gen('Dim punkte.b[10]')
    const declAt = code.indexOf('unsigned char punkte[10];')
    const mainAt = code.indexOf('int main(void) {')
    expect(declAt).toBeGreaterThanOrEqual(0)
    expect(declAt).toBeLessThan(mainAt) // arrays live at file scope (static)
  })

  it('declares a 2D array as a flat width*height block', () => {
    const { code } = gen('Dim feld.b[40, 25]')
    expect(code).toContain('unsigned char feld[(40) * (25)];')
  })

  it('indexes a 1D array', () => {
    const { code } = gen('Dim punkte.b[10]\npunkte[3] = 5')
    expect(code).toContain('punkte[3] = 5;')
  })

  it('maps a 2D index to zeile*breite+spalte (spalte first, zeile second)', () => {
    const { code } = gen('Dim feld.b[40, 25]\nfeld[2, 3] = 1')
    // zeile(3) * breite(40) + spalte(2)
    expect(code).toContain('feld[(3) * (40) + (2)] = 1;')
  })

  it('reads a 2D element on the right-hand side', () => {
    const { code } = gen('Dim feld.b[40, 25]\nx.b = feld[2, 3]')
    expect(code).toContain('x = feld[(3) * (40) + (2)];')
  })

  it('honours a Const dimension', () => {
    const { code } = gen('Const BREITE = 40\nDim feld.b[BREITE, 25]\nfeld[1, 1] = 0')
    expect(code).toContain('#define BREITE (40)')
    expect(code).toContain('unsigned char feld[(BREITE) * (25)];')
    expect(code).toContain('feld[(1) * (BREITE) + (1)] = 0;')
  })

  it('reports an index into an undeclared array, leaves a TODO', () => {
    const { code, errors } = gen('x.b = nichtda[3]')
    expect(errors.some((e) => /nichtda/.test(e))).toBe(true)
    expect(code).toContain('/* TODO: nichtda[] nicht deklariert */')
  })
})

describe('codegen: records (Type/Field/EndType, §C)', () => {
  const RECORD = ['Type Slot', '  Field item.b', '  Field count.w', 'EndType'].join('\n')

  it('emits a C struct with the field types', () => {
    const { code } = gen(RECORD)
    expect(code).toContain('struct Slot {')
    expect(code).toContain('unsigned char item;')
    expect(code).toContain('unsigned int count;')
    expect(code).toContain('};')
  })

  it('declares a record array as struct Name[N] at file scope, after the struct', () => {
    const { code } = gen(`${RECORD}\nDim tasche.Slot[20]`)
    const structAt = code.indexOf('struct Slot {')
    const arrAt = code.indexOf('struct Slot tasche[20];')
    const mainAt = code.indexOf('int main(void) {')
    expect(structAt).toBeGreaterThanOrEqual(0)
    expect(arrAt).toBeGreaterThan(structAt) // struct defined before it's used
    expect(arrAt).toBeLessThan(mainAt) // array at file scope
  })

  it('maps backslash field access to C dot access (write and read)', () => {
    const src = `${RECORD}\nDim tasche.Slot[20]\ntasche[3]\\count = 5\nx.w = tasche[3]\\count`
    const { code } = gen(src)
    expect(code).toContain('tasche[3].count = 5;')
    expect(code).toContain('x = tasche[3].count;')
  })

  it('warns when a .w field is read into a .b variable (narrowing)', () => {
    const src = `${RECORD}\nDim tasche.Slot[20]\nklein.b = tasche[0]\\count`
    const { warnings, errors } = gen(src)
    expect(errors).toEqual([])
    expect(warnings.some((w) => /Verkleinerung/.test(w))).toBe(true)
  })

  it('reports an unknown field on a record', () => {
    const src = `${RECORD}\nDim tasche.Slot[20]\ntasche[0]\\nope = 1`
    const { errors } = gen(src)
    expect(errors.some((e) => /kein Feld 'nope'/.test(e))).toBe(true)
  })

  it('compiles a field whose name collides with an SSOT word (M3.T0b)', () => {
    // `len` collides with the Len function. Declared + assigned as a field, it must
    // build through lex → parse → codegen, end-to-end, no errors.
    const src = ['Type Slot', '  Field len.b', 'EndType', 'Dim tasche.Slot[20]', 'tasche[0]\\len = 2'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('struct Slot {')
    expect(code).toContain('tasche[0].len = 2;')
  })
})

describe('codegen: SetMode + VWait (Stufe 2, §E/§F)', () => {
  it('maps VWait to waitvsync()', () => {
    const { code } = gen('VWait')
    expect(code).toContain('waitvsync();')
  })

  it('SetMode TEXT, MULTICOLOR sets the MCM bit, clears BMM (text)', () => {
    const { code, errors } = gen('SetMode TEXT, MULTICOLOR')
    expect(errors).toEqual([])
    expect(code).toContain('VIC.ctrl2 |= 0x10;') // multicolor on
    expect(code).toContain('VIC.ctrl1 = VIC.ctrl1 & 0x5F;') // text (not bitmap)
  })

  it('SetMode TEXT, HIRES clears both mode bits', () => {
    const { code } = gen('SetMode TEXT, HIRES')
    expect(code).toContain('VIC.ctrl2 &= ~0x10;') // hires (not multicolor)
    expect(code).toContain('VIC.ctrl1 = VIC.ctrl1 & 0x5F;') // text
  })

  it('SetMode BITMAP, MULTICOLOR sets both mode bits', () => {
    const { code } = gen('SetMode BITMAP, MULTICOLOR')
    expect(code).toContain('VIC.ctrl1 = (VIC.ctrl1 | 0x20) & 0x7F;') // bitmap
    expect(code).toContain('VIC.ctrl2 |= 0x10;') // multicolor
  })

  // $D011 IS NOT A NORMAL REGISTER (S1 Schritt 3, T3b — found by a real game). Writing it
  // sets the raster compare's 9th bit; READING it gives back the beam's current line 8. A
  // plain read-modify-write therefore copies wherever the beam happened to be into the
  // interrupt's line number, and a split armed for line 321 never fires again: Into The
  // Deep froze on the way back from its title picture with $D011 = $9B, waiting forever
  // for a tick. So bit 7 is never written back from a read, in any mode.
  it('never writes the beam’s own position back into $D011', () => {
    for (const mode of ['SetMode TEXT, MULTICOLOR', 'SetMode TEXT, HIRES', 'SetMode BITMAP, MULTICOLOR']) {
      const { code } = gen(mode)
      expect(code).not.toContain('VIC.ctrl1 |= ')
      expect(code).not.toContain('VIC.ctrl1 &= ~0x20;')
      // …whatever it writes, bit 7 is masked out of it.
      expect(code).toMatch(/VIC\.ctrl1 = [^;]*0x(5F|7F)[^;]*;/)
    }
  })

  it('SetMode TEXT alone defaults to HIRES (color mode optional)', () => {
    const { code, errors } = gen('SetMode TEXT')
    expect(errors).toEqual([])
    expect(code).toContain('VIC.ctrl2 &= ~0x10;')
  })

  it('rejects BITMAP, HIRES (not a Phase-1 mode)', () => {
    const { errors } = gen('SetMode BITMAP, HIRES')
    expect(errors.some((e) => /nicht vorgesehen/.test(e))).toBe(true)
  })
})

describe('codegen: honest failure (no crash)', () => {
  it('reports a command without a C mapping yet, leaves a TODO marker', () => {
    // SetMetaTile isn't mapped yet (still `since: later` in the SSOT) — the generic
    // "no C-mapping" path reports honestly and leaves a TODO marker.
    // (This used to use DrawImage, which B2.T4 built.)
    const { code, errors } = gen('SetMetaTile 1, 2, 3')
    expect(errors.some((e) => /SetMetaTile/.test(e))).toBe(true)
    expect(code).toContain('/* TODO: SetMetaTile')
  })
})

describe('codegen: tile world (M3.T1) — SetTile/GetTile/TileAt/TileSolid', () => {
  it('SetTile pokes Screen-RAM + Color-RAM at row*40+col (multicolor bit set)', () => {
    const { code, errors } = gen('SetTile 2, 3, 7, RED')
    expect(errors).toEqual([])
    expect(code).toContain('BC_SCREEN[(3) * BC_SCR_W + (2)] = 7;')
    expect(code).toContain('COLOR_RAM[(3) * BC_SCR_W + (2)] = (COLOR_RED) | 8;')
    expect(code).toContain('#define BC_SCREEN')
  })

  it('GetTile layer 0 reads Screen-RAM', () => {
    const { code, errors } = gen('t.b = GetTile(4, 5)')
    expect(errors).toEqual([])
    expect(code).toContain('t = BC_SCREEN[(5) * BC_SCR_W + (4)];')
  })

  it('GetTile layer 1 reads the baked (all-zero) data layer', () => {
    const { code, errors } = gen('t.b = GetTile(4, 5, 1)')
    expect(errors).toEqual([])
    expect(code).toContain('static unsigned char BC_DATA[40 * 25];')
    expect(code).toContain('t = BC_DATA[(5) * BC_SCR_W + (4)];')
  })

  it('TileAt emits the pixel→cell→tile helper and calls it', () => {
    const { code, errors } = gen('t.b = TileAt(120, 100)')
    expect(errors).toEqual([])
    expect(code).toContain('static unsigned char bc_tile_at(')
    expect(code).toContain('t = bc_tile_at(120, 100);')
  })

  it('TileSolid looks up solidity per tile via bc_solid[] — no wrapper function (STAHL S10/S11)', () => {
    const { code, errors } = gen('blocked.b = TileSolid(120, 100)')
    expect(errors).toEqual([])
    expect(code).not.toContain('bc_tile_solid_at') // the extra call layer is gone (S10)
    expect(code).toContain('blocked = bc_solid[bc_tile_at(120, 100)];') // solidity is a TILE property (S11)
  })

  it('without a tileset, bc_solid is all-zero — nothing solid by default (STAHL S11)', () => {
    // The S11 default: an unpainted/absent charset blocks nothing, so DrawText/HUD letters
    // (non-zero in Screen-RAM) never collide. The user paints walls in the editor.
    const { code } = gen('blocked.b = TileSolid(120, 100)')
    expect(code).toContain('static const unsigned char bc_solid[256] = {')
    expect(code).toContain('  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,')
    expect(code).not.toMatch(/bc_solid\[256\] = \{[^}]*[1-9]/) // no solid slot anywhere
  })

  it('bc_tile_at uses the row*40 table, not a per-pixel shift chain (STAHL S10)', () => {
    // 40 is not a power of two; even the shift/add chain is 16-bit work per pixel. The
    // collision lookup runs once per pixel during movement, so it indexes a precomputed
    // row→offset table (one load) instead.
    const { code } = gen('blocked.b = TileSolid(120, 100)')
    expect(code).toContain('static const unsigned int bc_row40[25] = { 0, 40, 80,')
    expect(code).toContain('return BC_SCREEN[bc_row40[row] + col];')
    expect(code).not.toContain('row * BC_SCR_W')
    expect(code).not.toContain('(((row) << 5) + ((row) << 3))')
  })

  it('SetTile with a VARIABLE row strength-reduces the ×40 (a literal row stays folded)', () => {
    const { code, errors } = gen('Global r.b = 0\nGlobal c.b = 0\nSetTile c, r, 7, RED')
    expect(errors).toEqual([])
    expect(code).toContain('BC_SCREEN[(((r) << 5) + ((r) << 3)) + (c)] = 7;')
  })

  it('does not emit tile-world helpers when unused', () => {
    const { code } = gen('x.b = 1')
    expect(code).not.toContain('bc_tile_at')
    expect(code).not.toContain('BC_DATA')
  })

  it('reports too few args honestly', () => {
    const { errors } = gen('SetTile 1, 2')
    expect(errors.some((e) => /SetTile erwartet/.test(e))).toBe(true)
  })
})

describe('codegen: signed type .i (P1, for physics)', () => {
  it('.i maps to signed int and holds negatives', () => {
    const { code, errors } = gen(['vy.i = 0', 'vy = 0 - 820'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('int vy = 0;')
    expect(code).toContain('vy = (0 - 820);') // M1.T1: always-parens
  })

  it('signed is contagious in expressions (.i + .b → .i target ok, no narrowing warn)', () => {
    const src = ['vy.i = 0', 'g.b = 40', 'vy = vy + g'].join('\n')
    const { warnings, errors } = gen(src)
    expect(errors).toEqual([])
    expect(warnings).toEqual([]) // widening into signed, no loss
  })

  it('warns when a signed value is written into an unsigned word (sign loss)', () => {
    const src = ['vy.i = 0', 'x.w = 0', 'x = vy'].join('\n')
    const { warnings } = gen(src)
    expect(warnings.some((w) => /Verkleinerung/.test(w))).toBe(true)
  })

  it('warns when a signed value is written into a byte', () => {
    const src = ['vy.i = 0', 'b.b = 0', 'b = vy'].join('\n')
    const { warnings } = gen(src)
    expect(warnings.some((w) => /Verkleinerung/.test(w))).toBe(true)
  })

  it('.i is not mistaken for a record suffix (and .item still lexes as field)', () => {
    // a .i var and a record field \item must coexist without confusion
    const src = [
      'Type Cell',
      '  Field item.b',
      'EndType',
      'Dim grid.Cell[2]',
      'v.i = 0',
      'grid[0]\\item = 3'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('int v = 0;')
    expect(code).toContain('grid[0].item = 3;')
  })
})

/**
 * TYPEN-PLAN T3 — the one-byte signed type.
 *
 * Why it exists, honestly: a walking direction that only ever holds -1 or +1 had to be
 * declared `.i` for want of anything narrower, and each one cost two bytes. `.s` costs
 * one and says what it means. It does NOT make the program faster — measured in
 * `_intern/wide-ops.test.ts`, MoveBlob with `.i` and with `.s` assembles to the same 130
 * instructions, because C promotes every signed char to int for arithmetic. The user was
 * shown that number and chose the type anyway, for the RAM and the readability.
 */
describe('codegen: signed byte .s (TYPEN-PLAN T3)', () => {
  it('.s maps to signed char and holds negatives', () => {
    const { code, errors } = gen(['bdir.s = 1', 'bdir = 0 - 1'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('signed char bdir = 0;') // declaration; the assignment follows
    expect(code).toContain('bdir = (0 - 1);')
  })

  it('.s beside a .b stays SIGNED and stays NARROW', () => {
    // The whole point: `bdir * SPEED` must not read -1 as 255 (that would be `byte`),
    // and must not silently become two bytes wide (that would be `sint`).
    const src = ['bdir.s = 1', 'speed.b = 2', 'step.s = 0', 'step = bdir * speed'].join('\n')
    const { code, warnings, errors } = gen(src)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(code).toContain('step = (signed char)(bdir * speed);')
  })

  it('.s next to a wide value widens to .i, not to .w', () => {
    // Width wins over narrowness; sign survives the widening.
    const src = ['bdir.s = 1', 'far.w = 300', 'out.i = 0', 'out = bdir * far'].join('\n')
    const { warnings, errors } = gen(src)
    expect(errors).toEqual([])
    expect(warnings).toEqual([]) // widening into signed: nothing is lost
  })

  it('warns when a signed byte is written into an unsigned target (-1 becomes 255)', () => {
    const src = ['bdir.s = 0', 'b.b = 0', 'b = bdir'].join('\n')
    const { warnings } = gen(src)
    expect(warnings.some((w) => /Verkleinerung/.test(w))).toBe(true)
  })

  it('warns when something wider is written into a .s', () => {
    const src = ['big.w = 300', 'bdir.s = 0', 'bdir = big'].join('\n')
    const { warnings } = gen(src)
    expect(warnings.some((w) => /Verkleinerung/.test(w))).toBe(true)
  })

  it('.s ← .s is silent', () => {
    const src = ['a.s = 1', 'b.s = 0', 'b = a'].join('\n')
    const { warnings, errors } = gen(src)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('counts down with a .s counter (signed, so it can pass zero)', () => {
    const { code, errors } = gen('For i.s = 10 To 0 Step -1\nNext')
    expect(errors).toEqual([])
    expect(code).toContain('signed char i')
    expect(code).toContain('i >= 0')
  })

  it('.s is not mistaken for a record suffix (and .speed still lexes as a record)', () => {
    const src = [
      'Type Ship',
      '  Field speed.b',
      'EndType',
      'Dim fleet.Ship[2]',
      'd.s = 0',
      'fleet[0]\\speed = 3'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('signed char d = 0;')
    expect(code).toContain('fleet[0].speed = 3;')
  })

  it('a .s field makes a one-byte member in a record', () => {
    const src = ['Type Blob', '  Field bx.w', '  Field bdir.s', 'EndType', 'Dim blobs.Blob[3]'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('signed char bdir;')
  })

  /**
   * ★ THE TRAP THE PLAN INSISTED SHIP WITH `.s`.
   *
   * Saving one byte on a direction field is a good trade right up until it takes the
   * record off a power of two — then every `blobs[i]` costs a software multiply instead
   * of a shift ([[breadcraft-record-array-multiply-trap]]), and the source says nothing
   * about it. The language's job is to make that visible, not to decide it in secret.
   */
  it('warns when a .s takes a record array off a power of two', () => {
    const src = [
      'Type Blob',
      '  Field bx.w', // 2
      '  Field by.w', // 2
      '  Field hp.b', // 1
      '  Field bspr.b', // 1
      '  Field bdir.s', // 1  → seven in total, and the multiply is back
      'EndType',
      'Dim blobs.Blob[3]'
    ].join('\n')
    const { warnings, errors } = gen(src)
    expect(errors).toEqual([])
    expect(warnings.some((w) => /7 Byte/.test(w) && /Zweierpotenz/.test(w))).toBe(true)
  })

  it('…and stays quiet at eight bytes', () => {
    const src = [
      'Type Blob',
      '  Field bx.w', // 2
      '  Field by.w', // 2
      '  Field hp.b', // 1
      '  Field bspr.b', // 1
      '  Field bhurt.b', // 1
      '  Field bdir.s', // 1  → eight: the index is a shift again
      'EndType',
      'Dim blobs.Blob[3]'
    ].join('\n')
    const { warnings, errors } = gen(src)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('a lone record variable has no stride, so it is not nagged about', () => {
    // Only an INDEXED record pays the multiply; warning here would be pure noise.
    const src = ['Type Odd', '  Field a.b', '  Field b.b', '  Field c.b', 'EndType', 'p.Odd', 'p\\a = 1'].join('\n')
    const { warnings } = gen(src)
    expect(warnings.filter((w) => /Zweierpotenz/.test(w))).toEqual([])
  })
})

/**
 * TYPEN-PLAN T5 — the widths, made visible.
 *
 * The plan came here expecting to find that a name without a suffix is sixteen bits and
 * merely wasteful. It is the other way round: an unsuffixed name is a BYTE, and until now
 * a value too big for one was accepted without a word — `punkte = 5000` compiled to
 * `unsigned char punkte; punkte = 5000;` and the machine stored 136. Not a performance
 * question at all; a correctness one.
 */
describe('codegen: constants that do not fit (TYPEN-PLAN T5)', () => {
  it('warns when a literal is too big for the (defaulted) byte it lands in', () => {
    const { warnings } = gen('punkte = 5000')
    expect(warnings.some((w) => /5000 passt nicht/.test(w) && /0…255/.test(w))).toBe(true)
  })

  it('…through a Const as well, since that is where the number hides', () => {
    const { warnings } = gen(['Const N = 5000', 'punkte = N'].join('\n'))
    expect(warnings.some((w) => /5000 passt nicht/.test(w))).toBe(true)
  })

  it('…and into an array element', () => {
    const { warnings } = gen(['Dim feld[3]', 'feld[0] = 999'].join('\n'))
    expect(warnings.some((w) => /999 passt nicht/.test(w))).toBe(true)
  })

  it('warns on a negative into an unsigned type', () => {
    const { warnings } = gen(['x.b = 0', 'x = 0 - 5'].join('\n'))
    expect(warnings.some((w) => /passt nicht/.test(w))).toBe(true)
  })

  it('…but -1 into a .s is exactly what the type is for, so it stays quiet', () => {
    const { warnings, errors } = gen(['bdir.s = 0', 'bdir = 0 - 1'].join('\n'))
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('a value that fits says nothing', () => {
    const { warnings, errors } = gen(['punkte.w = 5000', 'leben.b = 3'].join('\n'))
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  /**
   * ONE RULE, NO CORNERS (user's decision, 2026-07-30).
   *
   * A parameter without a suffix used to be the single WIDE thing in the language
   * (`?? 'word'`, "reserve the wider"). The reasoning was sound on its own — a byte might
   * be too small — but it meant that saying nothing meant one thing in eighteen places and
   * something else in the nineteenth, and a rule with one corner is a rule nobody can
   * carry in their head. No suffix now means eight bits everywhere, and the compiler warns
   * instead of quietly making room.
   */
  it('a parameter without a suffix is a byte, like everything else without a suffix', () => {
    const { code } = gen(['Function F(p)', '  q.b = p', 'EndFunction', 'F(1)'].join('\n'))
    // The parameter shows up in the C signature — or, if the INLINE_PLAN pass is ever armed
    // again, as a declaration at the caller's scope carrying that paste's own prefix (T3).
    // Byte either way; that is the rule being asserted, not the shape.
    expect(code).toMatch(
      INLINE_MAX_STMTS === 0 ? /void F\(unsigned char p\)/ : /unsigned char bc_i\d+_p = 0;/
    )
  })

  it('warns when the value handed to a byte parameter does not fit', () => {
    const { warnings } = gen(['Function F(p)', '  q.b = p', 'EndFunction', 'F(300)'].join('\n'))
    expect(warnings.some((w) => /300 passt nicht in 'p'/.test(w))).toBe(true)
  })

  it('…and says nothing when the parameter was given room', () => {
    const { warnings, errors } = gen(
      ['Function F(p.w)', '  q.w = p', 'EndFunction', 'F(300)'].join('\n')
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('the same check covers a value call, not just a statement call', () => {
    const { warnings } = gen(
      ['Function F.b(p)', '  Return p', 'EndFunction', 'z.b = F(999)'].join('\n')
    )
    expect(warnings.some((w) => /999 passt nicht in 'p'/.test(w))).toBe(true)
  })
})

/**
 * T5, second finding: a function with no suffix is a STATEMENT function and hands nothing
 * back ([[breadcraft-functions-vs-statements]]). The rule lived in the language but not in
 * the codegen, so `Function G()` + `Return 1` emitted `void G(void) { return 1; }` — which
 * cc65 rejects. The build failed with an error about a line of C the user never wrote.
 */
describe('codegen: Return with a value from a statement function (TYPEN-PLAN T5)', () => {
  it('is an error in CRUMB, not an error in C', () => {
    const { errors, code } = gen(['Function G()', '  Return 1', 'EndFunction'].join('\n'))
    expect(errors.some((e) => /liefert keinen Wert/.test(e))).toBe(true)
    expect(code).not.toContain('return 1;') // and the emitted C stays valid
  })

  it('a bare Return is fine', () => {
    const { errors } = gen(['Function G()', '  Return', 'EndFunction'].join('\n'))
    expect(errors).toEqual([])
  })

  it('…and with a suffix it is a value function, as intended', () => {
    const { errors, code } = gen(['Function G.b()', '  Return 1', 'EndFunction'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('return 1;')
  })
})

describe('codegen: math built-ins (P1.T4) — Abs/Min/Max', () => {
  it('Abs → cc65 abs() with a signed cast (|dx| for collision)', () => {
    const { code, errors } = gen('d.w = Abs(a.w - b.w)')
    expect(errors).toEqual([])
    expect(code).toContain('#include <stdlib.h>')
    expect(code).toContain('abs((int)((a - b)))') // M1.T1: always-parens around the Binary arg
  })

  it('Min → inline comparison (no helper, no header)', () => {
    const { code, errors } = gen('h.b = Min(hp.b + 5, 20)')
    expect(errors).toEqual([])
    expect(code).toContain('(((hp + 5)) < (20) ? ((hp + 5)) : (20))') // M1.T1: Binary arg now also parenthesized
  })

  it('Max → inline comparison', () => {
    const { code, errors } = gen('h.b = Max(hp.b - 3, 0)')
    expect(errors).toEqual([])
    expect(code).toContain('(((hp - 3)) > (0) ? ((hp - 3)) : (0))') // M1.T1: Binary arg now also parenthesized
  })

  it('no stdlib include when Abs is unused', () => {
    const { code } = gen('x.b = Max(1, 2)')
    expect(code).not.toContain('stdlib.h')
  })

  it('Abs / Min with too few args fail honestly', () => {
    expect(gen('x.w = Abs()').errors.some((e) => /Abs erwartet/.test(e))).toBe(true)
    expect(gen('x.w = Min(1)').errors.some((e) => /Min erwartet/.test(e))).toBe(true)
  })
})

describe('codegen: HUD strings (STAHL S8.T1) — Str$ + numeric DrawText', () => {
  it('DrawText of a number is run through Str$ so a score actually shows', () => {
    const { code, errors } = gen('Global score.w = 0\nDrawText 1, 1, score')
    expect(errors).toEqual([])
    expect(code).toContain('bc_drawtext(1, 1, bc_str(score), bc_pen);')
    // The helper + its header are emitted exactly when conversion is used.
    expect(code).toContain('#include <stdlib.h>')
    expect(code).toContain('static char bc_strbuf[6];')
    expect(code).toContain('char* bc_str(unsigned int n) { return utoa(n, bc_strbuf, 10); }')
  })

  it('DrawText of a string literal stays a plain string (no conversion)', () => {
    const { code } = gen('DrawText 0, 0, "GAME OVER"')
    expect(code).toContain('bc_drawtext(0, 0, "GAME OVER", bc_pen);')
    expect(code).not.toContain('bc_str')
    expect(code).not.toContain('bc_strbuf')
  })

  it('Str$(n) maps to the conversion helper', () => {
    const { code, errors } = gen('Global lives.b = 3\nDrawText 5, 0, Str$(lives)')
    expect(errors).toEqual([])
    // Already a string → DrawText does not double-wrap it.
    expect(code).toContain('bc_drawtext(5, 0, bc_str(lives), bc_pen);')
  })

  it('no string helper is emitted when nothing converts', () => {
    const { code } = gen('DrawText 0, 0, "HI"')
    expect(code).not.toContain('bc_str')
    expect(code).not.toContain('stdlib.h')
  })

  it('Str$ with no argument fails honestly', () => {
    expect(gen('DrawText 0, 0, Str$()').errors.some((e) => /Str\$ erwartet/.test(e))).toBe(true)
  })
})

describe('codegen: string buffers (STAHL S8.T2) — sizing, assignment, concatenation', () => {
  it('a string variable is sized from its literal and copied (not "=" assigned)', () => {
    const { code, errors } = gen('name$ = "Bob"')
    expect(errors).toEqual([])
    expect(code).toContain('char name[4];') // "Bob" + NUL
    expect(code).toContain('bc_scpy(name, "Bob", sizeof(name));')
    expect(code).not.toContain('name = "Bob"') // never the illegal array assignment
  })

  it('the buffer grows to the LONGEST literal ever assigned (later longer ones truncate)', () => {
    const { code } = gen(['msg$ = "hi"', 'msg$ = "a longer line"'].join('\n'))
    expect(code).toContain('char msg[14];') // longest = "a longer line" (13) + NUL
  })

  it('concatenation copies the first part and appends the rest, truncating', () => {
    const { code, errors } = gen(['Global score.w = 0', 'msg$ = "Score: " + Str$(score)'].join('\n'))
    expect(errors).toEqual([])
    // sized for "Score: " (7) + up to 5 digits + NUL = 13
    expect(code).toContain('char msg[13];')
    expect(code).toContain('bc_scpy(msg, "Score: ", sizeof(msg));')
    expect(code).toContain('bc_scat(msg, bc_str(score), sizeof(msg));')
    expect(code).toContain('#include <string.h>')
    expect(code).toContain('static void bc_scpy(')
    expect(code).toContain('static void bc_scat(')
  })

  it('a bare number in a concatenation is auto-converted (Str$)', () => {
    const { code } = gen(['Global n.b = 0', 'msg$ = "x" + n'].join('\n'))
    expect(code).toContain('bc_scat(msg, bc_str(n), sizeof(msg));')
  })

  it('a string global is copied into its buffer, not "=" assigned', () => {
    const { code, errors } = gen('Global title$ = "DEEP"')
    expect(errors).toEqual([])
    expect(code).toContain('char title[5];')
    expect(code).toContain('bc_scpy(title, "DEEP", sizeof(title));')
  })

  it('DrawText of a string variable passes it straight through (no conversion)', () => {
    const { code } = gen(['name$ = "Bob"', 'DrawText 0, 0, name$'].join('\n'))
    expect(code).toContain('bc_drawtext(0, 0, name, bc_pen);')
  })

  it('self-append (s$ = s$ + x) skips the no-op self-copy and just appends', () => {
    const { code, errors } = gen(['Global p.b = 0', 'msg$ = "Score"', 'msg$ = msg$ + ": "', 'msg$ = msg$ + Str$(p)'].join('\n'))
    expect(errors).toEqual([])
    // The first assignment copies; the self-appends append only (no bc_scpy(msg, msg, …)).
    expect(code).toContain('bc_scpy(msg, "Score", sizeof(msg));')
    expect(code).toContain('bc_scat(msg, ": ", sizeof(msg));')
    expect(code).toContain('bc_scat(msg, bc_str(p), sizeof(msg));')
    expect(code).not.toContain('bc_scpy(msg, msg,')
    // Buffer grew to fit "Score" + ": " + up to 5 digits + NUL = 13.
    expect(code).toContain('char msg[13];')
  })

  it('no string-buffer helpers when no string variable is used', () => {
    const { code } = gen('x.b = 1')
    expect(code).not.toContain('bc_scpy')
    expect(code).not.toContain('string.h')
  })
})

describe('codegen: string functions (STAHL S8.T3) — Int/Len/Asc/Chr$ real, rest stubbed', () => {
  it('Int(s$) → atoi (string → number)', () => {
    const { code, errors } = gen(['name$ = "42"', 'n.w = Int(name$)'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('n = ((unsigned int)atoi(name));')
    expect(code).toContain('#include <stdlib.h>')
  })

  it('Len(s$) → strlen as a byte; pulls in string.h (not the buffer helpers)', () => {
    const { code, errors } = gen(['name$ = "Bob"', 'l.b = Len(name$)'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('l = ((unsigned char)strlen(name));')
    expect(code).toContain('#include <string.h>')
  })

  it('Asc(s$) → code of the first character', () => {
    const { code, errors } = gen('c.b = Asc("A")')
    expect(errors).toEqual([])
    expect(code).toContain('c = ((unsigned char)("A")[0]);')
  })

  it('Chr$(n) → a 1-character string via its own helper', () => {
    const { code, errors } = gen('DrawText 0, 0, Chr$(65)')
    expect(errors).toEqual([])
    expect(code).toContain('static char* bc_chr(unsigned char c)')
    expect(code).toContain('bc_drawtext(0, 0, bc_chr(65), bc_pen);')
  })

  it('Left$/Right$/Mid$/Find are recognized but stubbed honestly (not a generic gap)', () => {
    for (const fn of ['Left$("hi", 1)', 'Right$("hi", 1)', 'Mid$("hi", 1, 1)', 'Find("hi", "i")']) {
      const { errors } = gen(`x$ = "z"\ny$ = ${fn}`)
      // The honest deferral message, NOT the generic "no C mapping".
      expect(errors.some((e) => /volle?n? String-Stufe|Adventure/.test(e))).toBe(true)
      expect(errors.some((e) => /kein C-Mapping/.test(e))).toBe(false)
    }
  })

  it('a string function with no argument fails honestly', () => {
    expect(gen('n.b = Len()').errors.some((e) => /Len erwartet/.test(e))).toBe(true)
  })
})

describe('codegen: functions (P1.T3, Sprachdef §C.1)', () => {
  it('emits a value function before main, returning its scalar type', () => {
    const src = ['Function Distance.w(a.w, b.w)', '  Return a + b', 'EndFunction'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('unsigned int Distance(unsigned int a, unsigned int b) {')
    expect(code).toContain('return (a + b);') // M1.T1: always-parens
    // function appears before main
    expect(code.indexOf('Distance(')).toBeLessThan(code.indexOf('int main(void)'))
  })

  it('a no-suffix function is void (statement-function)', () => {
    const src = ['Function Heal(menge.b)', '  hp.b = hp + menge', 'EndFunction'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('void Heal(unsigned char menge) {')
  })

  // A call is a call — which is worth saying twice, because for a while today it was not. The
  // INLINE_PLAN T1 pass can write a small body where its call stood; measured on real hardware
  // it turned out to be a wash on cc65 (see inline.ts) and it is switched off. These two hold
  // the behaviour that ships; the pasted shape is pinned down in the sleeping block below, and
  // both sets of expectations exist so that re-arming the pass flips exactly one of them.
  it('a value call in an expression maps to a C call', () => {
    const src = [
      'Function Dbl.b(n.b)',
      '  Return n + n',
      'EndFunction',
      'x.b = Dbl(5)'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain(INLINE_MAX_STMTS === 0 ? 'x = Dbl(5);' : 'x = bc_r1;')
  })

  it('a statement call (no parens) maps to a C call statement', () => {
    const src = ['Function Ping()', '  BorderColor 0', 'EndFunction', 'Ping'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain(INLINE_MAX_STMTS === 0 ? 'Ping();' : 'do {   /* Ping(')
  })

  it('record param → const-pointer, field access via -> , call passes address (no copy)', () => {
    const src = [
      'Type Slot',
      '  Field item.b',
      '  Field count.b',
      'EndType',
      'Function Total.b(s.Slot)',
      '  Return s\\item + s\\count',
      'EndFunction',
      'Dim bag.Slot[4]',
      'r.b = Total(bag[0])'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('unsigned char Total(const struct Slot *s) {')
    // M1.T1: always-parens — plus the byte narrowing from TYPEN-PLAN T2: both fields
    // are .b, so the sum is byte arithmetic and is written as such.
    expect(code).toContain('return (unsigned char)(s->item + s->count);')
    expect(code).toContain('r = Total(&bag[0]);') // address, not a copy
  })

  it('forbids direct recursion with an honest error', () => {
    const src = ['Function Fib.w(n.b)', '  Return Fib(n)', 'EndFunction'].join('\n')
    const { errors } = gen(src)
    expect(errors.some((e) => /Rekursion ist nicht erlaubt/.test(e))).toBe(true)
  })

  it('reports a call to an undefined function honestly', () => {
    const { errors } = gen('DoThing 5')
    expect(errors.some((e) => /Unbekannte Funktion 'DoThing'/.test(e))).toBe(true)
  })

  it('function locals stay local (not leaked into main)', () => {
    const src = [
      'Function Calc.b(n.b)',
      '  tmp.b = n + 1',
      '  Return tmp',
      'EndFunction',
      'main_var.b = 7'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    // tmp declared inside the function body, not at file scope or in main
    const fnPart = code.slice(code.indexOf('Calc('), code.indexOf('int main'))
    expect(fnPart).toContain('unsigned char tmp')
    const mainPart = code.slice(code.indexOf('int main'))
    expect(mainPart).not.toContain('tmp')
  })
})

// =====================================================================================
// TYPEN-PLAN T2 — "a byte is a byte", in the generated C too.
//
// CRUMB's type rule always said `byte + byte → byte`; the emitted C did not, so C
// widened every such sum to `int` and cc65 dutifully did 16-bit arithmetic between two
// 8-bit values. Writing the narrowing down makes the language's own claim true.
//
// ★ This CHANGES WHAT PROGRAMS MEAN (200 + 100 on two .b values is 44, not 300) and was
// a deliberate user decision (2026-07-29). These tests pin both halves of the bargain:
// the narrowing itself, and the warning that catches the one case where somebody
// plausibly wanted the big number.
// =====================================================================================
// =====================================================================================
// 16-Bit-Lokale in die ZEROPAGE (`register`, cc65 --register-vars).
//
// On cc65's software stack a 16-bit local costs a SUBROUTINE CALL per access
// (`ldax0sp`, `stax0sp`, `addeqysp` are all `jsr`s); in the zero page it is
// `lda zp / ldx zp+1`. The toll is one push and one pop of the register bank per call.
//
// The rule is the TYPE, not a use count — and that is measured, not guessed
// (2026-07-29, `_intern/wide-ops.test.ts`, per variable on Into The Deep): every 16-bit
// local wins or breaks even, every BYTE local is a wash, because a byte on the stack
// needs no helper call in the first place and would only pay the toll. A blanket
// `register` on all 47 locals was measured too and comes out WORSE.
// =====================================================================================
describe('codegen: 16-bit locals go to the zero page', () => {
  it('puts a .w / .i local of a function in the register bank', () => {
    const src = ['Function Tick()', '  weit.w = 0', '  delta.i = 0', '  weit = weit + 1', 'EndFunction', 'Tick'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    // The optional prefix is INLINE_PLAN T3: with the paste pass armed the body's locals are
    // declared at the CALLER's function scope under a per-paste name — still `register`,
    // which is the whole point (cc65 honours the keyword nowhere else).
    expect(code).toMatch(/register unsigned int (bc_i\d+_)?weit = 0;/)
    expect(code).toMatch(/register int (bc_i\d+_)?delta = 0;/)
  })

  it('leaves a byte local on the stack — it would only pay the toll', () => {
    const src = ['Function Tick()', '  klein.b = 0', '  klein = klein + 1', 'EndFunction', 'Tick'].join('\n')
    const { code } = gen(src)
    expect(code).toMatch(/unsigned char (bc_i\d+_)?klein = 0;/)
    expect(code).not.toMatch(/register unsigned char (bc_i\d+_)?klein/)
  })

  it('does the same for main’s own locals (a name without Global)', () => {
    const { code } = gen(['weit.w = 0', 'klein.b = 0', 'weit = weit + 1'].join('\n'))
    expect(code).toContain('  register unsigned int weit = 0;')
    expect(code).toContain('  unsigned char klein = 0;')
  })

  it('never marks a file-scope global — C does not allow it', () => {
    const { code, errors } = gen(['Global weit.w = 0', 'weit = weit + 1'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('unsigned int weit = 0;')
    expect(code).not.toContain('register unsigned int weit')
  })

  it('leaves strings alone (they are buffers, not values)', () => {
    const { code } = gen(['name$ = "ABC"'].join('\n'))
    expect(code).not.toContain('register char')
  })
})

describe('codegen: byte arithmetic stays 8 bits (TYPEN-PLAN T2)', () => {
  it('writes the narrowing for a byte calculation', () => {
    const { code, errors } = gen(['a.b = 200', 'b.b = 100', 'c.b = 0', 'c = a + b'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('c = (unsigned char)(a + b);')
  })

  it('leaves honestly wide arithmetic alone', () => {
    const { code } = gen(['a.b = 200', 'w.w = 1000', 'r.w = 0', 'r = a + w'].join('\n'))
    expect(code).toContain('r = (a + w);')
    expect(code).not.toContain('(unsigned char)(a + w)')
  })

  it('does not narrow a comparison — that result is a flag, not a value', () => {
    const { code } = gen(['a.b = 1', 'b.b = 2', 'c.b = 0', 'If a > b Then c = 1'].join('\n'))
    expect(code).toContain('if ((a > b))')
    expect(code).not.toContain('(unsigned char)(a > b)')
  })

  it('does not narrow a logical And/Or either', () => {
    const { code } = gen(['a.b = 1', 'b.b = 2', 'c.b = 0', 'If a > 0 And b > 0 Then c = 1'].join('\n'))
    expect(code).not.toContain('(unsigned char)((a > 0) &&')
  })

  it('narrows the inner step of a chain too, so the whole sum stays 8 bits', () => {
    const { code } = gen(['a.b = 1', 'b.b = 2', 'c.b = 3', 'r.b = 0', 'r = (a + b) * c'].join('\n'))
    expect(code).toContain('r = (unsigned char)(((unsigned char)(a + b)) * c);')
  })

  // --- the guard rail -----------------------------------------------------------
  const wraps = (w: string[]): string[] => w.filter((m) => /256/.test(m))

  it('warns when byte arithmetic is written into a wide destination', () => {
    const { warnings, errors } = gen(['spalte.b = 40', 'pixel.w = 0', 'pixel = spalte * 8'].join('\n'))
    expect(errors).toEqual([])   // a warning, not a refusal: wrapping on purpose is allowed
    const hit = wraps(warnings)
    expect(hit.length, 'a .b calculation stored into a .w must be flagged').toBe(1)
    expect(hit[0]).toMatch(/pixel/)
  })

  it('stays quiet when the same calculation goes into a byte', () => {
    const { warnings } = gen(['spalte.b = 40', 'reihe.b = 0', 'reihe = spalte * 8'].join('\n'))
    expect(wraps(warnings)).toEqual([])
  })

  it('stays quiet for plain widening — that holds no surprise', () => {
    const { warnings } = gen(['b.b = 7', 'w.w = 0', 'w = b'].join('\n'))
    expect(wraps(warnings)).toEqual([])
  })

  it('stays quiet when one operand is already wide', () => {
    const { warnings } = gen(['spalte.b = 40', 'acht.w = 8', 'pixel.w = 0', 'pixel = spalte * acht'].join('\n'))
    expect(wraps(warnings)).toEqual([])
  })
})

describe('codegen: sprites (M3.T2) — Sprite/ShowSprite/HideSprite', () => {
  it('Sprite n,x,y sets position, carries the 9th X bit, sets Y', () => {
    const { code, errors } = gen('Sprite 0, 160, 120')
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_pos[0].x = (unsigned char)((160) & 0xFF);')
    expect(code).toContain('if ((160) & 0x100) VIC.spr_hi_x |= (1 << (0)); else VIC.spr_hi_x &= ~(1 << (0));')
    expect(code).toContain('VIC.spr_pos[0].y = (120);')
  })

  it('Sprite n,x,y works with variable args (n any expression)', () => {
    const { code, errors } = gen(['s.b = 3', 'px.w = 300', 'Sprite s, px, 80'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_pos[s].x = (unsigned char)((px) & 0xFF);')
    // A slot only known at runtime takes the bit TABLE, not a shift (TYPEN-PLAN T4).
    expect(code).toContain('VIC.spr_hi_x |= bc_bit[s]')
  })

  it('Sprite n, OFF disables the sprite (off-variant)', () => {
    const { code, errors } = gen('Sprite 2, OFF')
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_ena &= ~(1 << (2));')
    expect(code).not.toContain('spr_pos[2]')
  })

  it('ShowSprite / HideSprite flip the enable bit', () => {
    const { code, errors } = gen(['ShowSprite 1', 'HideSprite 7'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_ena |= (1 << (1));')
    expect(code).toContain('VIC.spr_ena &= ~(1 << (7));')
  })

  // --- TYPEN-PLAN T4: `1 << n` only costs something when n is a runtime value -------
  // Measured with cc65 (_intern/wide-ops.test.ts): a constant shift is folded into an
  // immediate and costs nothing, a runtime shift becomes `aslaxy` — a loop. Into The
  // Deep hits the runtime case twice per blob per frame (`ShowSprite blobs[i]\bspr`),
  // and the world's tail hits it three times per slot. Hence the table — but ONLY where
  // it pays, so every program with constant slots stays byte-identical.
  describe('the bit table (TYPEN-PLAN T4)', () => {
    it('keeps the folded shift for a constant slot and emits no table at all', () => {
      const { code, errors } = gen(['ShowSprite 1', 'HideSprite 7'].join('\n'))
      expect(errors).toEqual([])
      expect(code).toContain('VIC.spr_ena |= (1 << (1));')
      expect(code).toContain('VIC.spr_ena &= ~(1 << (7));')
      expect(code).not.toContain('bc_bit')
    })

    it('counts a Const as constant too — a named slot is still free', () => {
      const { code, errors } = gen(['Const PLAYER = 1', 'ShowSprite PLAYER'].join('\n'))
      expect(errors).toEqual([])
      expect(code).toContain('VIC.spr_ena |= (1 << (PLAYER));')
      expect(code).not.toContain('bc_bit')
    })

    it('uses the table for a slot only known at runtime, and declares it once', () => {
      const { code, errors } = gen(['s.b = 3', 'ShowSprite s', 'HideSprite s'].join('\n'))
      expect(errors).toEqual([])
      expect(code).toContain('VIC.spr_ena |= bc_bit[s];')
      expect(code).toContain('VIC.spr_ena &= ~bc_bit[s];')
      expect(code).toContain('static const unsigned char bc_bit[8] = { 1, 2, 4, 8, 16, 32, 64, 128 };')
      expect(code.split('bc_bit[8]').length - 1, 'the table must be declared exactly once').toBe(1)
    })

    it('declares the table before anything reads it', () => {
      const { code } = gen(['s.b = 3', 'ShowSprite s'].join('\n'))
      expect(code.indexOf('bc_bit[8]')).toBeLessThan(code.indexOf('bc_bit[s]'))
    })

    it('a program without sprites never pays for it', () => {
      expect(gen('x.b = 1').code).not.toContain('bc_bit')
    })
  })

  it('marks sprite use in the header (asset-baking seam) only when used', () => {
    const { code } = gen('Sprite 0, 100, 100')
    expect(code).toContain('/* sprites: positions/enable via VIC registers (c64.h) */')
    expect(gen('x.b = 1').code).not.toContain('/* sprites:')
  })

  it('Sprite with too few args fails honestly', () => {
    const { errors } = gen('Sprite 0, 100')
    expect(errors.some((e) => /Sprite erwartet/.test(e))).toBe(true)
  })

  it('Sprite n,x,y,frame bends the pointer to that frame (SA4)', () => {
    const src = ['UseSprite 0, "player"', 'Sprite 0, 100, 100, 1'].join('\n')
    const { code, errors } = gen(src, fakeAssets())
    expect(errors).toEqual([])
    // Position still set, plus the one-byte pointer swap to bc_spr_base + frame.
    expect(code).toContain('VIC.spr_pos[0].x = (unsigned char)((100) & 0xFF);')
    expect(code).toContain('BC_SPR_PTR[0] = bc_spr_base[0] + (1);')
  })

  it('Sprite n,x,y (3-arg) leaves the pointer untouched (no frame swap)', () => {
    const { code } = gen(['UseSprite 0, "player"', 'Sprite 0, 100, 100'].join('\n'), fakeAssets())
    // UseSprite sets the frame-0 pointer; the 3-arg Sprite must NOT add a `+ (frame)` swap.
    expect(code).not.toContain('bc_spr_base[0] + (')
  })

  it('a variable frame index works (the user drives the cycle, e.g. tick Mod n)', () => {
    const src = ['t.b = 9', 'UseSprite 0, "player"', 'Sprite 0, 100, 100, t Mod 2'].join('\n')
    const { code, errors } = gen(src, fakeAssets())
    expect(errors).toEqual([])
    // `t` is .b, so `t Mod 2` is byte arithmetic and carries T2's narrowing.
    expect(code).toContain('BC_SPR_PTR[0] = bc_spr_base[0] + ((unsigned char)(t % 2));')
  })

  it('warns (best-effort) when a constant frame is past the slot’s baked frame count', () => {
    // player has 2 frames (0,1) → frame 2 is out of range.
    const src = ['UseSprite 0, "player"', 'Sprite 0, 100, 100, 2'].join('\n')
    const { warnings, errors } = gen(src, fakeAssets())
    expect(errors).toEqual([])
    expect(warnings.some((w) => /nur 2 Frame/.test(w))).toBe(true)
  })

  it('does NOT warn when the constant frame is in range', () => {
    const src = ['UseSprite 0, "player"', 'Sprite 0, 100, 100, 1'].join('\n')
    const { warnings } = gen(src, fakeAssets())
    expect(warnings.some((w) => /Frame/.test(w))).toBe(false)
  })

})

describe('codegen: UseSprite (P2.T3) — bake a painted sprite into the program', () => {
  it('bakes ALL frames, copies them to consecutive blocks, points the slot at frame 0', () => {
    const { code, errors } = gen('UseSprite 0, "player"', fakeAssets())
    expect(errors).toEqual([])
    // Both frames baked into one flat array (2 × 63 = 126 bytes) — SA3.
    expect(code).toContain('static const unsigned char sprite_player[126]')
    expect(code).toMatch(/255,/) // frame 0 first byte
    expect(code).toContain('66') // 0x42 = 66, frame 0's last byte
    expect(code).toMatch(/153, 153, 153/) // 0x99 = 153 (frame 1) IS now baked too
    // Copy loop walks the flat source into block (localBase + f); localBase = 0 here.
    expect(code).toContain('const unsigned char* _src = sprite_player;')
    expect(code).toContain('_d = BC_SPR_DATA(0 + _f)')
    expect(code).toContain('_d[_s] = *_src++')
    // Runtime slot→base table + pointer at frame 0.
    expect(code).toContain('static unsigned char bc_spr_base[8];')
    expect(code).toContain('bc_spr_base[0] = BC_SPR_BLOCK0 + 0;')
    expect(code).toContain('BC_SPR_PTR[0] = bc_spr_base[0];')
  })

  it('lays consecutive sprites at consecutive base blocks (SA3 + the allocator)', () => {
    const src = ['UseSprite 0, "player"', 'UseSprite 1, "player"'].join('\n')
    const { code, errors } = gen(src, fakeAssets())
    expect(errors).toEqual([])
    // player has 2 frames → slot 0 takes blocks 0–1, slot 1 starts at block 2.
    expect(code).toContain('bc_spr_base[0] = BC_SPR_BLOCK0 + 0;')
    expect(code).toContain('bc_spr_base[1] = BC_SPR_BLOCK0 + 2;')
    expect(code).toContain('_d = BC_SPR_DATA(2 + _f)') // second sprite copies into blocks 2+
  })

  it('emits the sprite-data memory-map defines in the header when used', () => {
    const { code } = gen('UseSprite 0, "player"', fakeAssets())
    expect(code).toContain('#define BC_SPR_DATA(i)')
    expect(code).toContain('#define BC_SPR_PTR')
    expect(code).toContain('#define BC_SPR_BLOCK0')
  })

  it('sets the multicolor bit + shared registers (from the default palette) in MULTICOLOR mode', () => {
    // fakeAssets has no .palette → DEFAULT_PALETTE (shared1=brown, shared2=lightblue).
    const { code, errors } = gen('SetMode TEXT, MULTICOLOR\nUseSprite 1, "player"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_mcolor |= (1 << (1));')
    expect(code).toContain('VIC.spr_mcolor0 = COLOR_BROWN;')
    expect(code).toContain('VIC.spr_mcolor1 = COLOR_LIGHTBLUE;')
    expect(code).toContain('VIC.spr_color[1] = COLOR_WHITE;')
  })

  it('reads the SHARED sprite colours from the project palette (the coupling)', () => {
    // A real .palette → its shared1/shared2 indices become spr_mcolor0/1, so the
    // running sprite matches what the editor painted (memory project-palette).
    const assets = fakeAssets()
    assets.manifest.palette = 'project.palette'
    const withPal: AssetContext = {
      manifest: assets.manifest,
      readFile: (rel) =>
        rel === 'project.palette'
          ? JSON.stringify({ format: 'breadcraft.palette', background: 6, shared1: 2, shared2: 7 })
          : assets.readFile(rel)
    }
    const { code, errors } = gen('SetMode TEXT, MULTICOLOR\nUseSprite 0, "player"', withPal)
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_mcolor0 = COLOR_RED;') // shared1 = 2
    expect(code).toContain('VIC.spr_mcolor1 = COLOR_YELLOW;') // shared2 = 7
  })

  it('clears the multicolor bit in HIRES mode', () => {
    const { code, errors } = gen('SetMode TEXT, HIRES\nUseSprite 0, "player"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_mcolor &= ~(1 << (0));')
    expect(code).not.toContain('VIC.spr_mcolor0 =')
  })

  it('accepts a variable slot (expression indexes the runtime tables)', () => {
    const { code, errors } = gen(['s.b = 3', 'UseSprite s, "player"'].join('\n'), fakeAssets())
    expect(errors).toEqual([])
    // Data blocks come from the compile-time allocator (localBase 0), independent of the
    // variable slot; the slot only indexes the runtime base table + the pointer slots.
    expect(code).toContain('_d = BC_SPR_DATA(0 + _f)')
    expect(code).toContain('bc_spr_base[s] = BC_SPR_BLOCK0 + 0;')
    expect(code).toContain('BC_SPR_PTR[s] = bc_spr_base[s];')
  })

  it('errors on a constant slot out of range (0–7)', () => {
    const { errors } = gen('UseSprite 8, "player"', fakeAssets())
    expect(errors.some((e) => /Slot 8 gibt es nicht/.test(e))).toBe(true)
  })

  it('errors on an unknown sprite id (strict, at the command)', () => {
    const { errors } = gen('UseSprite 0, "ghost"', fakeAssets())
    expect(errors.some((e) => /unbekanntes Sprite .ghost./.test(e))).toBe(true)
  })

  it('errors with no project context', () => {
    const { errors } = gen('UseSprite 0, "player"')
    expect(errors.some((e) => /kein Projekt-Kontext/.test(e))).toBe(true)
  })

  it('errors when the second arg is not a string name', () => {
    const { errors } = gen('UseSprite 0, 5', fakeAssets())
    expect(errors.some((e) => /Sprite-Name in Anführungszeichen/.test(e))).toBe(true)
  })

  it('errors with too few args', () => {
    const { errors } = gen('UseSprite "player"', fakeAssets())
    expect(errors.some((e) => /Slot .* und einen Sprite-Namen/.test(e))).toBe(true)
  })
})

describe('codegen: UseSprite block allocator (SA2) — honest island ceiling', () => {
  // A project with a baked charset → bank 1, whose sprite island holds exactly 16 blocks
  // (memory-map spriteBlocksAvail). The allocator draws one block per frame, so a player
  // with N frames takes N blocks; build it on demand to probe the ceiling.
  function islandAssets(frameCount: number): AssetContext {
    const charset = JSON.stringify({
      format: 'breadcraft.petscii',
      charCount: 256,
      chars: Array.from({ length: 256 }, () => [0, 0, 0, 0, 0, 0, 0, 0])
    })
    const sprite = JSON.stringify({
      format: 'breadcraft.sprite',
      frames: Array.from({ length: frameCount }, () => Array.from({ length: 63 }, () => 0))
    })
    const files: Record<string, string> = { 'main.petscii': charset, 'player.sprite': sprite }
    return {
      manifest: { palette: null, charsets: ['main.petscii'], tilemaps: [], sprites: ['player.sprite'], images: [] },
      readFile: (rel) => (rel in files ? files[rel] : null)
    }
  }

  it('passt knapp: a 15-frame sprite fits under the 16-block bank-1 ceiling', () => {
    const { errors } = gen('UseTileset "main"\nUseSprite 0, "player"', islandAssets(15))
    expect(errors).toEqual([])
  })

  it('passt exakt: a 16-frame sprite fills the island to the brim, no error', () => {
    const { errors } = gen('UseTileset "main"\nUseSprite 0, "player"', islandAssets(16))
    expect(errors).toEqual([])
  })

  it('läuft über: a 17-frame sprite overflows the island → honest build error', () => {
    const { errors } = gen('UseTileset "main"\nUseSprite 0, "player"', islandAssets(17))
    expect(errors.some((e) => /Sprite-Insel ist voll/.test(e))).toBe(true)
    // The message is concrete: 0 used, needs 17, only 16 free.
    expect(errors.some((e) => /0 Blöcke belegt.*braucht 17.*nur noch 16/.test(e))).toBe(true)
  })

  it('accumulates across calls: two 10-frame sprites overflow on the second', () => {
    const src = ['UseTileset "main"', 'UseSprite 0, "player"', 'UseSprite 1, "player"'].join('\n')
    const { errors } = gen(src, islandAssets(10))
    // First UseSprite takes blocks 0–9; the second needs 10 more but only 6 remain.
    expect(errors.some((e) => /10 Blöcke belegt.*braucht 10.*nur noch 6/.test(e))).toBe(true)
  })

  it('without a charset the island is bigger (bank 0, 32 blocks): 20 frames fit', () => {
    const noCharset: AssetContext = {
      manifest: { palette: null, charsets: [], tilemaps: [], sprites: ['player.sprite'], images: [] },
      readFile: (rel) =>
        rel === 'player.sprite'
          ? JSON.stringify({
              format: 'breadcraft.sprite',
              frames: Array.from({ length: 20 }, () => Array.from({ length: 63 }, () => 0))
            })
          : null
    }
    const { errors } = gen('UseSprite 0, "player"', noCharset)
    expect(errors).toEqual([])
  })
})

describe('codegen: input (M3.T3) — Joystick / KeyDown / KeyHit', () => {
  it('Joystick(DIR) maps to the cc65 test macro on joy_read(JOY_2)', () => {
    const { code, errors } = gen('If Joystick(LEFT) Then px = px - 1')
    expect(errors).toEqual([])
    expect(code).toContain('JOY_LEFT(joy_read(JOY_2))')
  })

  it('FIRE maps to the button macro JOY_BTN_1', () => {
    const { code, errors } = gen('If Joystick(FIRE) Then x.b = 1')
    expect(errors).toEqual([])
    expect(code).toContain('JOY_BTN_1(joy_read(JOY_2))')
  })

  it('using Joystick pulls in the driver header and installs it once in main', () => {
    const { code } = gen('If Joystick(UP) Then y.b = 0')
    expect(code).toContain('#include <joystick.h>')
    expect(code).toContain('joy_install(joy_static_stddrv);')
    // install runs before the user body — count exactly one install
    expect(code.match(/joy_install/g)?.length).toBe(1)
  })

  it('no joystick header/install when Joystick is unused', () => {
    const { code } = gen('x.b = 1')
    expect(code).not.toContain('joystick.h')
    expect(code).not.toContain('joy_install')
  })

  it('Joystick without a direction fails honestly', () => {
    const { errors } = gen('x.b = Joystick(5)')
    expect(errors.some((e) => /Joystick erwartet eine Richtung/.test(e))).toBe(true)
  })

  it('KeyDown / KeyHit are honestly deferred to the keyboard milestone', () => {
    const down = gen('If KeyDown(KEY_SPACE) Then x.b = 1')
    const hit = gen('If KeyHit(KEY_RETURN) Then x.b = 1')
    expect(down.errors.some((e) => /Tastatur/.test(e))).toBe(true)
    expect(hit.errors.some((e) => /Tastatur/.test(e))).toBe(true)
  })
})

describe('codegen: UseTileset + DrawMap (tile world)', () => {
  it('copies the charset into bank 1 ($7000) and switches the VIC bank (B1.T4)', () => {
    const { code, errors } = gen('UseTileset "main"', fakeAssets())
    expect(errors).toEqual([])
    // A charset moves graphics to bank 1: charset at $7000, copied there at runtime from a
    // RODATA const (compact .prg), VIC pointed at the bank-1 screen+charset ($EC).
    expect(code).toContain('#define BC_CHARSET ((unsigned char*)0x7000)')
    expect(code).toContain('static const unsigned char tileset_main[2048]')
    expect(code).toMatch(/1, 2, 3, 4, 5, 6, 7, 8/) // char 1 bytes baked
    expect(code).toContain('BC_CHARSET[_i] = tileset_main[_i]')
    expect(code).toContain('VIC.addr = 0xEC;')
    expect(code).toContain('#define BC_SCREEN  ((unsigned char*)0x7800)')
    // The CIA2 bank switch runs once in setup, before anything draws.
    expect(code).toContain('CIA2.ddra |= 0x03;')
    expect(code).toContain('CIA2.pra = (CIA2.pra & 0xFC) | 0x02;')
  })

  it('blanks the relocated screen at startup — the KERNAL only clears $0400 (B1.T5)', () => {
    // Bank 1 (custom charset) sets the visible screen to $7800, which the KERNAL never
    // cleared. Without an explicit clear, a program that draws sparse text shows garbage
    // tiles in the unwritten cells. So bank-1 setup calls bc_cls() once, and bc_cls clears
    // screen codes AND colour RAM (a custom charset's slot $20 isn't guaranteed blank).
    const { code, errors } = gen('UseTileset "main"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('static void bc_cls(void)')
    expect(code).toContain('BC_SCREEN[_i] = 0x20')
    expect(code).toContain('COLOR_RAM[_i] =') // colour cleared too, matching clrscr
    expect(code).toContain('bc_cls();') // called in setup even though no Cls in the source
    // The clear runs after the bank switch.
    expect(code.indexOf('CIA2.pra')).toBeLessThan(code.indexOf('bc_cls();'))
  })

  it('bakes the map tiles and copies them into screen RAM', () => {
    const { code, errors } = gen('UseTileset "main"\nDrawMap "level1"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('static const unsigned char map_level1[1000]')
    expect(code).toContain('BC_SCREEN[_c] = map_level1[_c]')
    expect(code).toContain('COLOR_RAM[_c] = mapcol_level1[_c]')
  })

  it('bakes the painted per-cell Color-RAM colours (multicolor bit set)', () => {
    const { code, errors } = gen('UseTileset "main"\nDrawMap "level1"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('static const unsigned char mapcol_level1[1000]')
    // cell 0 = red (2) | 8 = 10, rest = light grey (15) | 8 = 15.
    expect(code).toMatch(/mapcol_level1\[1000\] = \{\s*10, 15, 15/)
  })

  it('errors honestly when DrawMap has no active tileset', () => {
    const { errors } = gen('DrawMap "level1"', fakeAssets())
    expect(errors.some((e) => /kein Tileset aktiv/.test(e))).toBe(true)
  })

  // S1.B3.1: PlayField + UseMap build the engine proven in _preflight/scroll_t3.c.
  describe('PlayField + UseMap (the scrolling world)', () => {
    const world = (extra = ''): string =>
      ['UseTileset "main"', 'PlayField 3, 12', 'UseMap "welt"', extra].join('\n')

    it('bakes the level COLUMN-major and sets the raster split from the band', () => {
      const { code, errors } = gen(world(), fakeAssets())
      expect(errors).toEqual([])
      expect(code).toContain('#define BC_BAND_TOP  3')
      expect(code).toContain('#define BC_BAND_H    10')
      expect(code).toContain('#define BC_MAP_W     120')
      expect(code).toContain('#define BC_SPLIT_IN  (51 + 8 * BC_BAND_TOP - 1)')
      expect(code).toContain('#define BC_SPLIT_OUT (51 + 8 * (BC_BAND_TOP + BC_BAND_H) - 1)')
      // 120 columns × 10 band rows, one column's cells next to each other — that is what
      // a coarse scroll step needs when it reveals a column.
      expect(code).toContain('static const unsigned char bc_lvl_welt[1200]')
      // The window is filled at setup, and the beam is taken over for the split.
      expect(code).toContain('bc_fill_window(0);')
      expect(code).toContain('bc_split_start();')
      expect(code).toContain('bc_split_stop();') // …and handed back if the program ever ends
    })

    it('turns VWait into the raster-split frame', () => {
      const { code } = gen(world('While 1\n  VWait\nWend'), fakeAssets())
      expect(code).toContain('static void bc_vwait(void)')
      expect(code).toContain('bc_vwait();')
      expect(code).not.toContain('waitvsync();')
    })

    // S1 Schritt 2: the two split writes live in a raster interrupt, so the program's own
    // frame code is no longer confined to the time the band takes to draw. Only those two
    // writes moved — the tail stays in the main program (cc65's zero page is not shareable).
    it('cuts the frame with a raster interrupt, not by waiting on $D012', () => {
      const { code } = gen(world('While 1\n  VWait\nWend'), fakeAssets())
      expect(code).toContain('static void bc_irq_split(void)')
      expect(code).toContain('*(void (**)(void))0x0314 = bc_irq_split;')
      expect(code).toContain('__asm__("jmp $ea81");') // …not $EA31: no keyboard scan
      // Armed a line early, then it meets its own line — an interrupt is 40-60 cycles late
      // and a $D016 written mid-line would shear that line.
      expect(code).toContain('VIC.rasterline = BC_SPLIT_IN - 1;')
      expect(code).toContain('__asm__("bcirqw1: lda $d012");')
      // …but it waits for "at or past", NEVER for "exactly" (S1 Schritt 3, T3b). If the tail
      // overran into the band this interrupt is already late, and `cpx / bne` would then
      // spin a WHOLE FRAME for that line to come round again — missing the other split,
      // turning the two-phase machine around, and freezing the game on a tick that never
      // arrives. `cmp / bcc` gives up: a seam for one frame instead of a dead machine.
      expect(code).toContain('__asm__("bcc bcirqw1");')
      expect(code).toContain('__asm__("bcc bcirqbot");')
      expect(code).not.toContain('cpx $d012')
      // The frame turns over on the interrupt's tick, not on a raster wait.
      expect(code).toContain('while (bc_tick == bc_last_tick) { }')
      expect(code).not.toContain('while (BC_RASTER != BC_SPLIT_OUT)')
      expect(code).not.toContain('while (BC_RASTER != BC_SPLIT_IN)')
    })

    // A program without a world keeps the plain frame sync — the engine costs nothing
    // to a game that never scrolls.
    it('leaves a non-scrolling program exactly as it was', () => {
      const { code } = gen('UseTileset "main"\nWhile 1\n  VWait\nWend', fakeAssets())
      expect(code).toContain('waitvsync();')
      expect(code).not.toContain('bc_vwait')
      expect(code).not.toContain('BC_BAND_TOP')
    })

    it('needs a play field first — otherwise nobody knows which rows travel', () => {
      const { errors } = gen('UseTileset "main"\nUseMap "welt"', fakeAssets())
      expect(errors.some((e) => /kein Spielfeld gesetzt/.test(e))).toBe(true)
    })

    it('needs a tileset, and a real map name', () => {
      const noTiles = gen('PlayField 3, 12\nUseMap "welt"', fakeAssets())
      expect(noTiles.errors.some((e) => /kein Tileset aktiv/.test(e))).toBe(true)
      const noName = gen(world().replace('UseMap "welt"', 'UseMap 7'), fakeAssets())
      expect(noName.errors.some((e) => /Karten-Namen in Anführungszeichen/.test(e))).toBe(true)
    })

    it('refuses rows that are not on the screen', () => {
      expect(gen('PlayField 3, 30', fakeAssets()).errors.some((e) => /zwischen 0 und 24/.test(e))).toBe(true)
      expect(gen('PlayField 12, 4', fakeAssets()).errors.some((e) => /zwischen 0 und 24/.test(e))).toBe(true)
    })

    it('insists the rows are known at build time (the split is a constant)', () => {
      const { errors } = gen('UseTileset "main"\nx.b = 3\nPlayField x, 12', fakeAssets())
      expect(errors.some((e) => /feste Zeilen/.test(e))).toBe(true)
    })

    it('takes a Const for the rows — that IS known at build time', () => {
      const { code, errors } = gen(
        'Const TOP = 3\nUseTileset "main"\nPlayField TOP, 12\nUseMap "welt"',
        fakeAssets()
      )
      expect(errors).toEqual([])
      expect(code).toContain('#define BC_BAND_TOP  3')
    })

    it('enters ONE world — a second is an honest error, not a silent overwrite', () => {
      const { errors } = gen(world('UseMap "welt2"'), fakeAssets())
      expect(errors.some((e) => /betritt schon die Welt "welt"/.test(e))).toBe(true)
    })

    it('will not move the band after the level was cut for it', () => {
      const { errors } = gen(world('PlayField 5, 14'), fakeAssets())
      expect(errors.some((e) => /kommt zu spät/.test(e))).toBe(true)
    })

    // The colour model follows the painting (@shared/level-cost): one colour per tile
    // buys the cheap 256-byte table, a tile in two colours pays per cell.
    it('bakes a tile→colour table when every tile keeps one colour', () => {
      const { code } = gen(world(), fakeAssets())
      expect(code).toContain('static const unsigned char bc_lvlcol_welt[256]')
      expect(code).toContain('COLOR_RAM[idx] = bc_lvlcol_welt[bc_lvl_welt[_s]];')
    })

    it('bakes colour per cell when a tile is painted in two colours, and says which', () => {
      const { code } = gen(
        'UseTileset "main"\nPlayField 3, 12\nUseMap "bunt"',
        fakeAssets()
      )
      expect(code).toContain('static const unsigned char bc_lvlcol_bunt[1200]')
      expect(code).toMatch(/colour per cell — tiles 80 are painted/)
      expect(code).toContain('COLOR_RAM[idx] = bc_lvlcol_bunt[_s];')
    })

    // S1.B5.T3: `blobs[idx]\bx` is, in C, "array + idx × sizeof + offset" — and cc65 works
    // that out on EVERY field, through runtime helper calls. Measured on the real machine:
    // Into The Deep's three enemies cost 11.830 cycles a frame (60 % of PAL) that way.
    describe('a record-array element is found once, not per field (S1.B5.T3)', () => {
      // ★ THE FUNCTION IS KEPT TOO BIG TO PASTE, ON PURPOSE. These cases are about the
      //   record-pointer pass and nothing else. Once INLINE_PLAN is armed a two-line function
      //   is pasted into main, and then every assertion here would really be describing the
      //   paste — the pointer under a per-paste name, the definition dropped as uncalled. The
      //   filler keeps the subject of the test on the table. What the pasted form looks like
      //   is asserted where it belongs, in the INLINE_PLAN describes below.
      const tooBigToPaste = Array.from(
        { length: INLINE_MAX_STMTS + 1 },
        (_, i) => `  fuell${i}.b = ${i}`
      )
      const withBlobs = (fnBody: string): string =>
        [
          'Type Blob',
          '  Field bx.w',
          '  Field by.b',
          '  Field hp.b',
          'End Type',
          'Dim blobs.Blob[3]',
          'Function Move(idx.b)',
          fnBody,
          ...tooBigToPaste,
          'End Function',
          'Move(0)'
        ].join('\n')

      it('holds the element in a pointer when a function visits it more than once', () => {
        const { code, errors } = gen(
          withBlobs('  blobs[idx]\\bx = blobs[idx]\\bx + 1\n  blobs[idx]\\hp = 2'),
          fakeAssets()
        )
        expect(errors).toEqual([])
        // `register` puts it in the ZERO PAGE (cc65 --register-vars) — on the C stack the
        // pointer would have to be fetched for every field, which measured almost no win.
        expect(code).toContain('register struct Blob *bc_p_blobs_idx = &blobs[idx];')
        expect(code).toContain('bc_p_blobs_idx->bx = (bc_p_blobs_idx->bx + 1);')
        expect(code).toContain('bc_p_blobs_idx->hp = 2;')
        expect(code).not.toContain('blobs[idx].bx')
      })

      it('leaves a single visit alone (a pointer would only cost setup)', () => {
        const { code } = gen(withBlobs('  blobs[idx]\\hp = 0'), fakeAssets())
        expect(code).not.toContain('bc_p_blobs_idx')
        expect(code).toContain('blobs[idx].hp = 0;')
      })

      // The safety rule, and it is the whole reason this is narrow: the element may not
      // move under the pointer. An index the function ASSIGNS is exactly that case.
      it('refuses to hold a pointer when the index can change', () => {
        const { code } = gen(
          withBlobs('  idx = idx + 1\n  blobs[idx]\\bx = 1\n  blobs[idx]\\hp = 2'),
          fakeAssets()
        )
        expect(code).not.toContain('bc_p_blobs_idx')
        expect(code).toContain('blobs[idx].bx = 1;')
      })

      it('refuses it for a loop counter — that element moves every turn', () => {
        const { code } = gen(
          withBlobs('  For i.b = 0 To 2\n    blobs[i]\\bx = 1\n    blobs[i]\\hp = 2\n  Next'),
          fakeAssets()
        )
        expect(code).not.toContain('bc_p_blobs_i ')
        expect(code).toContain('blobs[i].bx = 1;')
      })

      it('holds one pointer per element a function visits', () => {
        const { code } = gen(
          [
            'Type Blob',
            '  Field bx.w',
            '  Field hp.b',
            'End Type',
            'Dim blobs.Blob[3]',
            'Function Swap(a.b, b.b)',
            '  blobs[a]\\bx = blobs[b]\\bx',
            '  blobs[a]\\hp = blobs[b]\\hp',
            // kept a call, for the reason given at `tooBigToPaste` above
            ...Array.from({ length: INLINE_MAX_STMTS + 1 }, (_, i) => `  fuell${i}.b = ${i}`),
            'End Function',
            'Swap(0, 1)'
          ].join('\n'),
          fakeAssets()
        )
        expect(code).toContain('*bc_p_blobs_a = &blobs[a];')
        expect(code).toContain('*bc_p_blobs_b = &blobs[b];')
        expect(code).toContain('bc_p_blobs_a->bx = bc_p_blobs_b->bx;')
      })
    })

    // S1.B5: a game defines its functions ABOVE the UseMap that enters the world (ITD does
    // it through Include), and calls them from the frame loop below it. The functions are
    // emitted first but they RUN last — so the world must be known before the walk, or a
    // function gets the pre-world shape of a statement in a scrolling program.
    describe('functions written above the UseMap (the ITD shape)', () => {
      const early = (fnBody: string, extra = ''): string =>
        [
          'Global px.w = 40',
          'Function Draw()',
          fnBody,
          'End Function',
          'UseTileset "main"',
          'UseSprite 0, "player"',
          'PlayField 3, 12',
          'UseMap "welt"',
          extra,
          'While 1',
          '  VWait',
          '  Draw',
          'Wend'
        ].join('\n')

      it('hands the sprite to the frame tail, not to the VIC directly', () => {
        const { code, errors } = gen(early('  Sprite 0, px, 100'), fakeAssets())
        expect(errors).toEqual([])
        // The world path. The old walk-order check emitted VIC.spr_pos writes here: the
        // hero would not ride on the world, and his registers would be written while the
        // beam draws the band — wrong, and silent.
        expect(code).toContain('bc_sprite(0, px, 100);')
        expect(code).not.toContain('VIC.spr_pos[0].x =')
      })

      it('counts the sprite slots it names, so the tail knows what to write', () => {
        const { code } = gen(early('  Sprite 2, px, 100'), fakeAssets())
        expect(code).toContain('#define BC_SPR_N     3')
      })

      it('turns a sprite on as a WISH (the tail decides what the VIC gets)', () => {
        const { code } = gen(early('  ShowSprite 0'), fakeAssets())
        expect(code).toContain('bc_spr_want |= (1 << (0));')
        expect(code).not.toContain('VIC.spr_ena |=')
      })

      it('lets a function bring the camera home — it runs after the world is entered', () => {
        const { code, errors } = gen(early('  SetCameraX 0'), fakeAssets())
        expect(errors).toEqual([])
        expect(code).toContain('bc_set_camx((int)(0));')
      })

      it('lets a function change the world (SetMapTile) and read the camera', () => {
        const { code, errors } = gen(early('  SetMapTile px, 100, 32\n  px = CameraX()'), fakeAssets())
        expect(errors).toEqual([])
        expect(code).toContain('bc_set_map_tile(')
        expect(code).toContain('px = bc_camx;')
      })

      // …but a straight-line statement runs exactly where it stands. Before the UseMap
      // there is no window yet, and saying so beats deciding something that the UseMap a
      // few lines down then overwrites.
      it('still refuses a camera moved at top level BEFORE the world is entered', () => {
        const src = [
          'UseTileset "main"',
          'PlayField 3, 12',
          'SetCameraX 0',
          'UseMap "welt"'
        ].join('\n')
        expect(gen(src, fakeAssets()).errors.some((e) => /kommt zu früh/.test(e))).toBe(true)
      })

      it('still refuses a camera in a program that has no world at all', () => {
        const src = 'UseTileset "main"\nSetCameraX 0'
        expect(gen(src, fakeAssets()).errors.some((e) => /keine Welt zum Anschauen/.test(e))).toBe(true)
      })
    })

    // S1.B4: the codegen is the only side that KNOWS what the band and the engine are, so
    // it reports it — the health bars read those figures instead of guessing them a second
    // time from the source (one truth about the world).
    describe('reports what the world costs (S1.B4)', () => {
      it('hands out the band, the camera and the level bytes', () => {
        const { engine, level } = genFacts(world('SetCameraX 8\nSprite 0, 100, 80'), fakeAssets())
        expect(engine).toEqual({
          usesCamera: true,
          bandRows: 10,
          spriteSlots: 1,
          colorModel: 'tileTable'
        })
        // 120 columns × 10 band rows + the 256-byte tile→colour table = what was baked.
        expect(level).toEqual({
          id: 'welt',
          columns: 120,
          bandRows: 10,
          bytes: 120 * 10 + 256,
          model: 'tileTable'
        })
      })

      it('says the window stands still when nothing moves it', () => {
        const { engine } = genFacts(world(), fakeAssets())
        expect(engine!.usesCamera).toBe(false)
      })

      it('counts the per-cell level at twice the column data (no table)', () => {
        const { level } = genFacts('UseTileset "main"\nPlayField 3, 12\nUseMap "bunt"', fakeAssets())
        expect(level).toEqual({
          id: 'bunt',
          columns: 120,
          bandRows: 10,
          bytes: 120 * 10 * 2,
          model: 'perCell'
        })
      })

      it('reports nothing for a program that has no world (there is nothing to report)', () => {
        const { engine, level } = genFacts('UseTileset "main"\nWhile 1\n  VWait\nWend', fakeAssets())
        expect(engine).toBeNull()
        expect(level).toBeNull()
      })
    })

    // S1.B3.2: the window travels. The band lives at screen $7800 (VIC bank 1, because a
    // tileset is baked) + 3 rows × 40 = $7878; Color-RAM is I/O and never moves: $D878.
    describe('SetCameraX + CameraX() (the window travels)', () => {
      const BAND = 0x7878
      const CBAND = 0xd878
      const hex = (n: number): string => '0x' + n.toString(16).toUpperCase().padStart(4, '0')

      it('decides while the program has the frame, and moves in the tail', () => {
        const { code, errors } = gen(world('SetCameraX 8\nWhile 1\n  VWait\nWend'), fakeAssets())
        expect(errors).toEqual([])
        // The call itself only decides…
        expect(code).toContain('bc_set_camx((int)(8));')
        // …the movement sits behind the split, in the frame's tail.
        expect(code).toMatch(
          /static void bc_vwait\(void\) \{[\s\S]*?if \(bc_cut\)[\s\S]*?bc_shift_left\(\)/
        )
        expect(code).toContain('bc_shown_col = bc_want_col;')
      })

      // S1 Schritt 2, Befund 2: with the interrupt doing the splitting, nothing holds a slow
      // program back any more — so the ENGINE has to. A step that no longer fits below the
      // band is dropped (the wish stands), because a stutter is an honest "too much code"
      // and a tear looks like broken hardware.
      it('drops the step instead of tearing when the frame ran long', () => {
        const { code } = gen(world('SetCameraX 8\nWhile 1\n  VWait\nWend'), fakeAssets())
        // Room below a ten-row band = 312 − 80 lines; the step itself costs 10 × 14 + 9
        // (Schritt 3: 850 cycles a band row, rounded up to whole raster lines — early
        // drops a step, late TEARS). It was 10 × 21 + 2 when the copy cost 1.331.
        expect(code).toContain('#define BC_TAIL_SLACK 83')
        expect(code).toContain('if ((unsigned int)(_r - BC_SPLIT_OUT) > BC_TAIL_SLACK) return;')
        // The deadline is only asked when there is something heavy to do…
        expect(code).toMatch(/if \(bc_dir_col \|\| bc_cut\) \{[\s\S]*?BC_TAIL_SLACK/)
        // …and a dropped step keeps its wish: neither the column nor the fine scroll moves,
        // because half a step is a jump, not a scroll.
        expect(code).toMatch(
          /BC_TAIL_SLACK\) return;[\s\S]*?bc_shown_col = bc_want_col;[\s\S]*?bc_d016_band = /
        )
      })

      // S1 Schritt 3, T3b — the regression a real game found. The deadline used to be asked
      // AFTER the sprite registers had been written, and the flush itself takes raster
      // lines: on a tall play field, where the slack is down to its floor, the answer was
      // always "too late", every step was refused, and the world stopped scrolling. The
      // sprites had moved by then though, against a band that had not — so the hero slid
      // across a frozen world, falling through ground drawn elsewhere and hitting walls that
      // were not there. One missed step, three symptoms.
      it('asks the deadline BEFORE it moves anything, sprites included', () => {
        const { code } = gen(
          world('Sprite 0, 100, 80\nSetCameraX 8\nWhile 1\n  VWait\nWend'),
          fakeAssets()
        )
        const tail = code.slice(code.indexOf('static void bc_vwait(void) {'))
        const deadline = tail.indexOf('BC_TAIL_SLACK) return;')
        const flush = tail.indexOf('bc_spr_flush();')
        const step = tail.indexOf('bc_shift_left();')
        expect(deadline).toBeGreaterThan(-1)
        expect(flush).toBeGreaterThan(-1)
        // …and in this order: ask, then move the sprites, then move the band.
        expect(deadline).toBeLessThan(flush)
        expect(flush).toBeLessThan(step)
        // A dropped frame therefore moves NOTHING — hero and world stay in lockstep.
        // The sprites' own cycles are part of what has to fit: one named slot is 130
        // cycles = 3 raster lines less slack than the same world without a sprite.
        expect(code).toContain('#define BC_TAIL_SLACK 80')
      })

      it('clamps at both level ends instead of wrapping', () => {
        const { code } = gen(world('SetCameraX 0'), fakeAssets())
        // 120 columns − 38 SEEN on screen = 82 columns × 8 pixels of travel. Not 40: the
        // engine scrolls in the VIC's 38-column mode, so the two outermost character
        // columns live behind the side border. Clamping at 40 hid the level's last two
        // columns for good (S1 Schritt 2, T4b).
        expect(code).toContain('#define BC_CAM_MAX   656')
        expect(code).toContain('if (x < 0) x = 0;')
        expect(code).toContain('if (x > 656) x = 656;')
        // …and the window then asks for map columns past the end, which are answered blank
        // rather than read out of bounds.
        expect(code).toContain('if (mapcol >= BC_MAP_W) {')
        expect(code).toContain('if (mc >= BC_MAP_W) {')
        // Signed all the way in: `SetCameraX CameraX() - 2` at the start must clamp to 0,
        // not wrap to the far end of the world.
        expect(code).toContain('static void bc_set_camx(int x)')
      })

      it('splits the price: $D016 every frame, a column every 8 pixels', () => {
        const { code } = gen(world('SetCameraX 8'), fakeAssets())
        expect(code).toContain('bc_xscroll_next = 7 - (bc_camx & 7);')
        expect(code).toContain('bc_want_col = bc_camx >> 3;')
        // One column forward → shift left, reveal at the right edge; one back → mirrored.
        expect(code).toContain('if (bc_want_col == bc_shown_col + 1) { bc_dir_col = 1;')
        expect(code).toContain('else if (bc_want_col + 1 == bc_shown_col) { bc_dir_col = -1;')
      })

      // S1 Schritt 3, T2: the copy that decides how tall a play field may be. Screen and
      // colour move under ONE index (counting it twice paid twice for one piece of
      // arithmetic) and eight cells go per turn of the loop, which takes the bookkeeping
      // from seven cycles a cell to under two. Measured on hardware in T1: 1.274 → 834
      // cycles per band row, and with it the ceiling from ten rows to fourteen.
      it('moves screen and colour under one index, eight cells to a turn', () => {
        const { code } = gen(world('SetCameraX 8'), fakeAssets())
        // 10 rows × 40 = 400 bytes, 399 of them travel (the last is the revealed column):
        // one full 256-byte block, then 136 in eights, then the seven left over.
        expect(code).toContain('__asm__("bcl0:");')
        expect(code).toContain(`__asm__("lda %w,x", ${hex(BAND + 1)}u);`)
        // …the colour of the very same cell, in the same breath — the VIC does not scroll
        // $D800, so it has to travel, and it travels under the index already loaded.
        expect(code).toContain(`__asm__("lda %w,x", ${hex(CBAND + 1)}u);`)
        // Eight cells, then the index moves once for all of them.
        expect(code).toMatch(
          /__asm__\("txa"\);\n\s*__asm__\("clc"\);\n\s*__asm__\("adc #\$08"\);\n\s*__asm__\("tax"\);/
        )
        // A whole 256-byte block ends on the index wrapping to zero — no compare at all.
        expect(code).toContain('__asm__("bne bcl0");')
        // …only the partial block pays one: 399 − 7 = 392, of which 256 are the first block.
        expect(code).toContain('__asm__("cpx #%b", (unsigned char)136);')
        // …and the seven the eights do not reach are plain absolute stores.
        expect(code).toContain(`__asm__("lda %w", ${hex(BAND + 399)}u);`)
        expect(code).toContain(`__asm__("sta %w", ${hex(BAND + 398)}u);`)
      })

      it('walks downwards on the way home, and never compares a byte (the T3 trap)', () => {
        const { code } = gen(world('SetCameraX 8'), fakeAssets())
        const home = code.slice(
          code.indexOf('static void bc_shift_right(void) {'),
          code.indexOf('static void bc_reveal_right(void) {')
        )
        // The way back tore first in T3, and it tore over two cycles a byte spent
        // comparing. The descending loop ends on the borrow out of zero instead, so the
        // last turn is the one at index 0 and nothing is compared anywhere in here.
        expect(home).toContain('__asm__("sbc #$08");')
        expect(home).toContain('__asm__("bcs bcr0");')
        expect(home).not.toContain('cpx')
        // Highest addresses first, or every byte would overwrite the one it is about to
        // read: the odd seven at the top come before the blocks.
        expect(home.indexOf(`${hex(BAND + 398)}u`)).toBeLessThan(
          home.indexOf(`${hex(BAND + 256)}u`)
        )
      })

      it('stamps the revealed column into the edge the shift vacated', () => {
        const { code } = gen(world('SetCameraX 8'), fakeAssets())
        // Walking right: column 39 of every band row. Walking back: column 0.
        expect(code).toContain(`__asm__("sta %w", ${hex(BAND + 39)}u);`)
        expect(code).toContain(`__asm__("sta %w", ${hex(CBAND + 39)}u);`)
        expect(code).toContain(`__asm__("sta %w", ${hex(BAND)}u);`)
        // …and the last band row is reached too (row 9 = 9 × 40).
        expect(code).toContain(`__asm__("sta %w", ${hex(BAND + 9 * 40 + 39)}u);`)
        expect(code).toContain('__asm__("lda %v+%b", bc_edge_t, (unsigned char)9);')
      })

      it('reads the window back with CameraX()', () => {
        const { code, errors } = gen(world('x.w = CameraX()'), fakeAssets())
        expect(errors).toEqual([])
        expect(code).toContain('= bc_camx;')
      })

      it('redraws the whole window on a jump — a cut, not a scroll', () => {
        const { code } = gen(world('SetCameraX 800'), fakeAssets())
        expect(code).toContain('else { bc_dir_col = 0; bc_cut = 1; return; }')
        expect(code).toContain('for (c = 0; c < BC_SCR_W; ++c) bc_fill_col(c, left + c);')
        expect(code).toContain('if (bc_cut) { bc_fill_window(bc_want_col); bc_cut = 0; }')
      })

      // S1 Schritt 2, T4: a full-screen image writes its colour layer into the very
      // Screen-RAM the band lives in, so coming back to the tile world means the window is
      // the picture's leftovers. The engine owns the window, so the engine repaints it.
      it('repaints the window when the program comes back to TEXT mode', () => {
        const { code } = gen(
          world('SetMode BITMAP, MULTICOLOR\nSetMode TEXT, MULTICOLOR'),
          fakeAssets()
        )
        expect(code).toContain('bc_fill_window(bc_shown_col);')
        // …but not on the way OUT, and not before the world exists.
        const before = gen(
          'UseTileset "main"\nSetMode TEXT, MULTICOLOR\nPlayField 3, 12\nUseMap "welt"',
          fakeAssets()
        ).code
        expect(before.indexOf('bc_fill_window(bc_shown_col)')).toBe(-1)
      })

      // A world that never moves must not pay for the machinery that moves it — the
      // program proven on hardware in B3.1 stays exactly what it was.
      it('costs a standing world nothing', () => {
        const { code } = gen(world('While 1\n  VWait\nWend'), fakeAssets())
        expect(code).toContain('static void bc_vwait(void)')
        expect(code).not.toContain('bc_set_camx')
        expect(code).not.toContain('BC_CAM_MAX')
        expect(code).not.toContain('bcsl0')
      })

      // S1.B3.3: the hero rides on the world. $D016 never moves a sprite, so its screen
      // position is our sum — and the registers may only be written below the band.
      describe('Follow (the camera hangs on the hero)', () => {
        it('remembers the sprite in MAP pixels and lets the tail write the VIC', () => {
          const { code, errors } = gen(world('Sprite 0, 200, 100'), fakeAssets())
          expect(errors).toEqual([])
          expect(code).toContain('bc_sprite(0, 200, 100);')
          // …not the register poke a standing program gets.
          expect(code).not.toContain('VIC.spr_pos[0].x = (unsigned char)((200) & 0xFF);')
          expect(code).toMatch(/static void bc_vwait\(void\) \{[\s\S]*?bc_spr_flush\(\);/)
        })

        it('turns a world position into a screen one, and hides what is outside', () => {
          const { code } = gen(world('Sprite 0, 200, 100'), fakeAssets())
          expect(code).toContain('sx = (int)bc_spr_mx[i] - (int)bc_camx + 24;')
          expect(code).toContain('if (sx < 0 || sx > 343) continue;')
          expect(code).toContain('VIC.spr_ena = ena;')
        })

        it('decides the camera where the hero is known — inside Sprite', () => {
          const { code, errors } = gen(
            world('Follow 0, 20\nWhile 1\n  VWait\n  Sprite 0, 200, 100\nWend'),
            fakeAssets()
          )
          expect(errors).toEqual([])
          expect(code).toContain('bc_follow_spr = 0;')
          expect(code).toContain('bc_follow_dead = 20;')
          expect(code).toContain('if (n == bc_follow_spr) bc_follow_now(mx);')
          // The leash: outside it the world is pulled to the hero's edge, inside it nothing
          // moves at all.
          expect(code).toContain('int mid = (int)mx - BC_SPR_MID;')
          expect(code).toContain('if (mid > cam + (int)bc_follow_dead) cam = mid - (int)bc_follow_dead;')
          expect(code).toContain('else return;')
          expect(code).toContain('bc_set_camx(cam);')
        })

        it('keeps him dead centre when no leash is given', () => {
          const { code } = gen(world('Follow 0'), fakeAssets())
          expect(code).toContain('bc_follow_spr = 0;')
          // …and no leash is set: the only mention is the declaration, which starts at 0.
          expect(code).not.toMatch(/^\s+bc_follow_dead = /m)
          // 148 = half the window (160) minus half a 24-pixel sprite.
          expect(code).toContain('#define BC_SPR_MID   148')
        })

        it('serves only the slots the program names', () => {
          const one = gen(world('Sprite 0, 200, 100'), fakeAssets())
          expect(one.code).toContain('#define BC_SPR_N     1')
          const three = gen(world('Sprite 2, 200, 100'), fakeAssets())
          expect(three.code).toContain('#define BC_SPR_N     3')
          // A slot only known at runtime means all eight have to be considered.
          const any = gen(world('i.b = 1\nSprite i, 200, 100'), fakeAssets())
          expect(any.code).toContain('#define BC_SPR_N     8')
        })

        // S1 Schritt 2, T4b — found by looking at the ported game: the diver was there and
        // the blobs were blank squares. The tail stamps the whole sprite set every frame,
        // pointer included, so a shape that lived only in the hardware register (because
        // that sprite never names a frame) was overwritten with a zero.
        it('tells the TAIL the shape too, not just the VIC register', () => {
          const { code } = gen(world('UseSprite 1, "player"\nSprite 1, 100, 100'), fakeAssets())
          expect(code).toContain('bc_spr_ptr[1] = bc_spr_base[1];')
          expect(code).toContain('BC_SPR_PTR[i] = bc_spr_ptr[i];')
        })

        it('flips a wish, not the register — the tail decides what is really shown', () => {
          const { code } = gen(world('Sprite 0, 200, 100\nShowSprite 0\nHideSprite 0'), fakeAssets())
          expect(code).toContain('bc_spr_want |= (1 << (0));')
          expect(code).toContain('bc_spr_want &= ~(1 << (0));')
          expect(code).not.toContain('VIC.spr_ena |= (1 << (0));')
        })

        it('shadows the shape swap too, so a sprite is never half old and half new', () => {
          const { code } = gen(world('Sprite 0, 200, 100, 1'), fakeAssets())
          expect(code).toContain('bc_spr_ptr[0] = bc_spr_base[0] + (1);')
          expect(code).toContain('BC_SPR_PTR[i] = bc_spr_ptr[i];')
        })

        // A game without a world writes the registers on the spot, exactly as before.
        it('leaves the sprites of a standing program exactly as they were', () => {
          const { code } = gen('UseTileset "main"\nSprite 0, 200, 100\nShowSprite 0', fakeAssets())
          expect(code).toContain('VIC.spr_pos[0].x = (unsigned char)((200) & 0xFF);')
          expect(code).toContain('VIC.spr_ena |= (1 << (0));')
          expect(code).not.toContain('bc_sprite')
          expect(code).not.toContain('bc_spr_flush')
        })

        it('says plainly that Follow needs a world, and a sprite', () => {
          const noWorld = gen('UseTileset "main"\nFollow 0', fakeAssets())
          expect(noWorld.errors.some((e) => /keine Welt zum Anschauen/.test(e))).toBe(true)
          const noArg = gen(world('Follow'), fakeAssets())
          expect(noArg.errors.some((e) => /Sprite-Nummer, der die Kamera folgen soll/.test(e))).toBe(true)
        })
      })

      // S1.B3.4: changing the world, and the one ruler every world question uses.
      describe('SetMapTile (the world changes, and it stays changed)', () => {
        it('writes the LEVEL, not just the picture — that is the whole point', () => {
          const { code, errors } = gen(world('SetMapTile 320, 90, 64'), fakeAssets())
          expect(errors).toEqual([])
          expect(code).toContain('bc_set_map_tile(320, 90, 64);')
          // The world in RAM: this is what survives the column scrolling out and back.
          expect(code).toContain('bc_lvl_welt[mcol * BC_BAND_H + (row - BC_BAND_TOP)] = t;')
          // …and the picture of it, only while that cell is inside the window.
          expect(code).toContain('if (mcol < bc_shown_col) return;')
          expect(code).toContain('BC_SCREEN[idx] = t;')
        })

        it('makes the level writable — a world that changes cannot be const', () => {
          const changing = gen(world('SetMapTile 320, 90, 64'), fakeAssets())
          expect(changing.code).toContain('static unsigned char bc_lvl_welt[1200] = {')
          // A program that only reads it keeps it read-only.
          const standing = gen(world(), fakeAssets())
          expect(standing.code).toContain('static const unsigned char bc_lvl_welt[1200] = {')
        })

        it('takes the colour from the tile when the level stores colour per tile', () => {
          const { code, errors } = gen(world('SetMapTile 320, 90, 64'), fakeAssets())
          expect(errors).toEqual([])
          expect(code).toContain('COLOR_RAM[idx] = bc_lvlcol_welt[t];')
        })

        it('warns instead of lying when a colour cannot be stored', () => {
          const { errors, warnings } = gen(world('SetMapTile 320, 90, 64, RED'), fakeAssets())
          // Not an error — it still does the sensible thing; but silence would unravel the
          // moment the column scrolls back in.
          expect(errors).toEqual([])
          expect(warnings.some((e) => /gehört die Farbe zur KACHEL/.test(e))).toBe(true)
        })

        it('stores the colour when the painting made it per cell', () => {
          const perCell = 'UseTileset "main"\nPlayField 3, 12\nUseMap "bunt"\nSetMapTile 320, 90, 64, RED'
          const { code, errors } = gen(perCell, fakeAssets())
          expect(errors).toEqual([])
          expect(code).toContain('bc_lvlcol_bunt[mcol * BC_BAND_H + (row - BC_BAND_TOP)] = (c & 0x0F) | 8;')
          expect(code).toContain('static unsigned char bc_lvlcol_bunt[1200] = {')
          // Leaving the colour out keeps what was painted (0xFF = don't touch).
          const noColour = gen(perCell.replace(', RED', ''), fakeAssets())
          expect(noColour.code).toContain('bc_set_map_tile(320, 90, 64, 0xFF);')
        })

        it('refuses to change a world that was never entered', () => {
          const { errors } = gen('UseTileset "main"\nSetMapTile 320, 90, 64', fakeAssets())
          expect(errors.some((e) => /es gibt aber keine/.test(e))).toBe(true)
          expect(errors.some((e) => /SetTile/.test(e))).toBe(true)
        })
      })

      // The decision B3.3 deliberately deferred: inside a world, every question about the
      // world speaks WORLD pixels — one ruler for the hero, for TileAt and for SetMapTile.
      describe('TileAt in a world', () => {
        it('asks in world pixels and answers from the window', () => {
          const { code, errors } = gen(world('t.b = TileAt(320, 90)'), fakeAssets())
          expect(errors).toEqual([])
          expect(code).toContain('static unsigned char bc_tile_at(unsigned int wx, unsigned char wy)')
          expect(code).toContain('if (col < bc_shown_col) return 0;')
          expect(code).toContain('col -= bc_shown_col;')
          // Cheap on purpose: a subtract, not the column × band-height multiply the level's
          // own layout would need on every call.
          expect(code).not.toContain('wx >> 3) * BC_BAND_H')
        })

        it('leaves a standing program asking in screen pixels, exactly as before', () => {
          const { code } = gen('UseTileset "main"\nt.b = TileAt(200, 90)', fakeAssets())
          expect(code).toContain('static unsigned char bc_tile_at(unsigned int px, unsigned char py)')
          expect(code).toContain('if (px < BC_SPR_X0 || py < BC_SPR_Y0) return 0;')
          expect(code).not.toContain('bc_shown_col')
        })
      })

      it('says plainly that a camera needs a world', () => {
        const noWorld = gen('UseTileset "main"\nSetCameraX 8', fakeAssets())
        expect(noWorld.errors.some((e) => /keine Welt zum Anschauen/.test(e))).toBe(true)
        const noWorldRead = gen('UseTileset "main"\nx.w = CameraX()', fakeAssets())
        expect(noWorldRead.errors.some((e) => /keine Welt zum Anschauen/.test(e))).toBe(true)
        const noArg = gen(world('SetCameraX'), fakeAssets())
        expect(noArg.errors.some((e) => /X-Position in Welt-Pixeln/.test(e))).toBe(true)
      })
    })
  })

  // S1.B2.T1: a map wider than the screen is a world you walk through, not a picture.
  // Baking it with DrawMap would shear it (row n starting mid-row) — so it says so, and
  // points at UseMap. Nothing is emitted for the sheared map.
  it('errors honestly when DrawMap gets a map wider than the screen', () => {
    const { code, errors } = gen('UseTileset "main"\nDrawMap "welt"', fakeAssets())
    expect(errors.some((e) => /120 Spalten breit.*UseMap/s.test(e))).toBe(true)
    expect(code).not.toContain('map_welt')
  })

  it('errors on an unknown tileset id (strict, at the command)', () => {
    const { errors } = gen('UseTileset "ghost"', fakeAssets())
    expect(errors.some((e) => /unbekanntes Tileset .ghost./.test(e))).toBe(true)
  })

  it('errors when there is no project context at all', () => {
    const { errors } = gen('UseTileset "main"')
    expect(errors.some((e) => /kein Projekt-Kontext/.test(e))).toBe(true)
  })

  it('errors when UseTileset gets no string id', () => {
    const { errors } = gen('UseTileset 5', fakeAssets())
    expect(errors.some((e) => /Tileset-Namen in/.test(e))).toBe(true)
  })

  it('bakes painted solid tiles into bc_solid[] so TileSolid blocks only marked tiles (STAHL S11)', () => {
    // A charset that marks slots 1 and 5 solid (the editor's sparse "solid" list).
    const charset = JSON.stringify({
      format: 'breadcraft.petscii',
      charCount: 256,
      chars: Array.from({ length: 256 }, () => [0, 0, 0, 0, 0, 0, 0, 0]),
      solid: [1, 5]
    })
    const assets: AssetContext = {
      manifest: { palette: null, charsets: ['main.petscii'], tilemaps: [], sprites: [], images: [] },
      readFile: (rel) => (rel === 'main.petscii' ? charset : null)
    }
    const { code, errors } = gen('UseTileset "main"\nblocked.b = TileSolid(120, 100)', assets)
    expect(errors).toEqual([])
    // Slots 1 and 5 are solid (1), every other slot is 0 — solidity travels with the charset.
    expect(code).toContain('static const unsigned char bc_solid[256] = {')
    expect(code).toContain('  0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,')
    expect(code).toContain('blocked = bc_solid[bc_tile_at(120, 100)];')
  })

  it('seeds the empty Hires font slots with the ROM font when the program draws text (F2)', () => {
    // A custom charset replaces the ROM font, so DrawText would index empty low slots and
    // show nothing. With text in the program, the empty font slots (0–63) get the ROM glyphs.
    // Slot 0 = '@' = [0x3c,0x66,0x6e,0x6e,0x60,0x62,0x3c,0x00]; slot 1 was painted [1..8] in
    // fakeAssets and must be KEPT (painted glyph wins). 16 bytes/row = slot 0 + slot 1.
    const { code, errors } = gen('UseTileset "main"\nDrawText 0, 0, "HI"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toMatch(/tileset_main\[2048\] = \{\s*60, 102, 110, 110, 96, 98, 60, 0, 1, 2, 3, 4, 5, 6, 7, 8,/)
  })

  it('does NOT seed the font region when the program draws no text (no stray letters on tiles)', () => {
    // Without DrawText/Color the charset is left exactly as painted — an empty low slot used
    // as a blank tile must stay blank, never gain a ROM letter.
    const { code, errors } = gen('UseTileset "main"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toMatch(/tileset_main\[2048\] = \{\s*0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8,/)
  })

  it('seeds even when DrawText sits inside a loop, after UseTileset (whole-program scan)', () => {
    const src = ['UseTileset "main"', 'While 1', '  DrawText 0, 0, "HI"', 'Wend'].join('\n')
    const { code, errors } = gen(src, fakeAssets())
    expect(errors).toEqual([])
    expect(code).toMatch(/tileset_main\[2048\] = \{\s*60, 102, 110, 110, 96, 98, 60, 0,/)
  })
})

describe('codegen: AnimateTile (animated-charset trick)', () => {
  it('registers an animated tile and hooks the tick onto VWait', () => {
    const { code, errors } = gen('UseTileset "main"\nAnimateTile 160, 64, 4, 8\nVWait', fakeAssets())
    expect(errors).toEqual([])
    // The registry + tick helper is emitted, and the call registers the tile.
    expect(code).toContain('static void bc_anim_tick(void)')
    expect(code).toContain('bc_anim_add(160, 64, 4, 8);')
    // VWait advances the animation once per frame.
    expect(code).toContain('waitvsync();\n  bc_anim_tick();')
  })

  it('saves the stage slot so a frame stored in it survives (stage inside the frame run)', () => {
    // The natural layout: key shown as tile 160, frames 160..163 — stage == first frame.
    const { code, errors } = gen('UseTileset "main"\nAnimateTile 160, 160, 4, 8', fakeAssets())
    expect(errors).toEqual([])
    // A per-registration home copy + the restore branch keep frame 0 from being lost.
    expect(code).toContain('static unsigned char bc_anim_home[BC_ANIM_MAX][8];')
    expect(code).toContain('if (src == dst) {')
    expect(code).toContain('BC_CHARSET[a + i] = bc_anim_home[k][i];')
    expect(code).toContain('bc_anim_add(160, 160, 4, 8);')
  })

  it('hooks the tick even when AnimateTile appears after the VWait (first-pass flag)', () => {
    const { code, errors } = gen('UseTileset "main"\nVWait\nAnimateTile 160, 64, 4, 8', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('waitvsync();\n  bc_anim_tick();')
  })

  it('emits neither helper nor tick when AnimateTile is unused', () => {
    const { code } = gen('UseTileset "main"\nVWait', fakeAssets())
    expect(code).not.toContain('bc_anim_tick();')
    expect(code).not.toContain('bc_anim_add')
  })

  it('errors without an active tileset (the frames are charset bytes)', () => {
    const { errors } = gen('AnimateTile 160, 64, 4, 8', fakeAssets())
    expect(errors.some((e) => /kein Tileset aktiv/.test(e))).toBe(true)
  })

  it('errors on too few arguments', () => {
    const { errors } = gen('UseTileset "main"\nAnimateTile 160, 64', fakeAssets())
    expect(errors.some((e) => /AnimateTile erwartet/.test(e))).toBe(true)
  })

  it('sizes the runtime table at 32 simultaneously animated tiles', () => {
    const { code } = gen('UseTileset "main"\nAnimateTile 160, 64, 4, 8', fakeAssets())
    expect(code).toContain('#define BC_ANIM_MAX 32')
  })

  it('does not warn at exactly 32 registrations (the table still fits)', () => {
    const calls = Array.from({ length: 32 }, (_, i) => `AnimateTile ${i}, 64, 4, 8`).join('\n')
    const { warnings } = gen(`UseTileset "main"\n${calls}`, fakeAssets())
    expect(warnings).toEqual([])
  })

  it('warns once on the 33rd registration (table full → tile stays still)', () => {
    const calls = Array.from({ length: 33 }, (_, i) => `AnimateTile ${i}, 64, 4, 8`).join('\n')
    const { warnings } = gen(`UseTileset "main"\n${calls}`, fakeAssets())
    const overflow = warnings.filter((w) => /mehr als 32/.test(w))
    expect(overflow.length).toBe(1)
  })
})

describe('codegen: UseImage / DrawImage (BRONZE B2.T3+T4) — a painted picture on the screen', () => {
  // The Use/Draw pair the language uses everywhere (UseTileset→DrawMap, UseSprite→Sprite):
  // UseImage bakes, DrawImage shows.
  const SRC = 'SetMode BITMAP, MULTICOLOR\nUseImage "titel"\nDrawImage "titel"\n'

  it('links the bitmap into the bank instead of copying it (the RAM-halving decision)', () => {
    const { code, errors } = gen(SRC, fakeAssets())
    expect(errors).toEqual([])
    // The 8000-byte matrix goes into its own linker segment, NON-static so cc65 emits an
    // array nothing references. No copy loop for it — that's the whole point: a const
    // source would cost the picture a second time in low RAM.
    expect(code).toContain('#pragma rodata-name (push, "BC_BITMAP")')
    expect(code).toContain('const unsigned char img_titel[8000] = {')
    expect(code).not.toContain('static const unsigned char img_titel')
    expect(code).toContain('#pragma rodata-name (pop)')
    expect(code).not.toMatch(/BC_BITMAP\[_i\]\s*=/) // never copied
    expect(code).toContain('  170, 0,') // the picture's position-coded first byte reached the bake
  })

  it('copies only the two colour planes — Color-RAM is I/O, the screen page gets overwritten', () => {
    const { code } = gen(SRC, fakeAssets())
    expect(code).toContain('#define BC_COLOR_RAM ((unsigned char*)0xD800)')
    expect(code).toContain('static const unsigned char imgscr_titel[1000] = {')
    expect(code).toContain('static const unsigned char imgcol_titel[1000] = {')
    expect(code).toContain('BC_SCREEN[_i] = imgscr_titel[_i]; BC_COLOR_RAM[_i] = imgcol_titel[_i];')
  })

  it('points the VIC at screen $5C00 + bitmap $6000 and takes the background from the picture', () => {
    const { code } = gen(SRC, fakeAssets())
    // $D018 = screen page 7 (bits 4-7) | bit 3 = bitmap at bank+$2000 ($6000).
    expect(code).toContain('VIC.addr = 0x78;')
    expect(code).toContain('#define BC_SCREEN  ((unsigned char*)0x5C00)')
    expect(code).toContain('#define BC_BITMAP  ((unsigned char*)0x6000)')
    // The picture's own background (6 = blue), not the project palette's.
    expect(code).toContain('VIC.bgcolor[0] = COLOR_BLUE;')
  })

  it('a picture + a tile game: the charset moves out of the bitmap\'s way, each mode gets its own $D018', () => {
    const { code, errors } = gen(`${SRC}SetMode TEXT, MULTICOLOR\nUseTileset "main"\n`, fakeAssets())
    expect(errors).toEqual([])
    // The charset drops from its usual $7000 to $5000 — the bitmap owns the bank's top.
    expect(code).toContain('#define BC_CHARSET ((unsigned char*)0x5000)')
    expect(code).toContain('VIC.addr = 0x78;') // bitmap mode (DrawImage)
    expect(code).toContain('VIC.addr = 0x74;') // text mode: screen page 7 | charset $5000
  })

  it('UseImage emits NO runtime code — the bake is the linker\'s job, hence `cheap`', () => {
    const { code } = gen('SetMode BITMAP, MULTICOLOR\nUseImage "titel"\n', fakeAssets())
    // The bytes are there…
    expect(code).toContain('const unsigned char img_titel[8000] = {')
    // …but nothing runs: no VIC pokes, no copy. All of that belongs to DrawImage.
    expect(code).not.toContain('VIC.addr = 0x78;')
    expect(code).not.toContain('BC_SCREEN[_i] = imgscr_titel[_i]')
  })

  it('showing the picture again is cheap: bakes once, copies only the colours each time', () => {
    const { code, errors } = gen(`${SRC}DrawImage "titel"\n`, fakeAssets())
    expect(errors).toEqual([])
    expect(code.match(/const unsigned char img_titel\[8000\]/g)?.length).toBe(1) // baked once
    expect(code.match(/\/\* DrawImage "titel" \*\//g)?.length).toBe(2) // shown twice
    // The 8000-byte matrix is never copied — only the 2×1000 colour planes are.
    expect(code.match(/BC_SCREEN\[_i\] = imgscr_titel\[_i\]/g)?.length).toBe(2)
  })

  it('DrawImage works INSIDE a function — functions are emitted before the top-level UseImage', () => {
    // The shape a real game wants: the bake sits in the setup, GoTitle() shows the picture.
    // A walk-order check would reject this (the DrawMap trap); the pre-scan doesn't.
    const { code, errors } = gen(
      'Function GoTitle()\n  SetMode BITMAP, MULTICOLOR\n  DrawImage "titel"\nEnd Function\nUseImage "titel"\nGoTitle\n',
      fakeAssets()
    )
    expect(errors).toEqual([])
    expect(code).toContain('/* DrawImage "titel" */')
  })

  it('a SECOND, different picture is an honest error, not a silent overwrite', () => {
    const { errors } = gen(`${SRC}UseImage "raum2"\n`, fakeAssets())
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/nur EIN Bild/)
    expect(errors[0]).toMatch(/Diskette/) // names the real way out (SILBER)
  })

  it('DrawImage without UseImage is an honest error — like DrawMap without UseTileset', () => {
    const { errors } = gen('SetMode BITMAP, MULTICOLOR\nDrawImage "titel"\n', fakeAssets())
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/kein Bild eingebacken/)
    expect(errors[0]).toMatch(/UseImage "titel"/) // says exactly what to do
  })

  it('DrawImage of a picture the program never baked names both sides', () => {
    const { errors } = gen(`${SRC}DrawImage "raum2"\n`, fakeAssets())
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/backt "titel" ein, nicht "raum2"/)
  })

  it('names the missing pieces honestly: no name, unknown picture', () => {
    expect(gen('UseImage\n', fakeAssets()).errors[0]).toMatch(/erwartet einen Bild-Namen/)
    expect(gen('UseImage "geist"\n', fakeAssets()).errors[0]).toMatch(/geist/)
    expect(gen('UseImage "titel"\nDrawImage\n', fakeAssets()).errors[0]).toMatch(/erwartet einen Bild-Namen/)
  })

  it('UseTileset is re-callable: baked once, copied on every call (mode switching, B2.T3)', () => {
    // A bitmap title screen switches the VIC to BITMAP; going back to the tile game calls
    // UseTileset again to point $D018 at text. Re-baking would emit a SECOND identical
    // `const` and cc65 rejects the redefinition — the build died before this guard.
    const { code, errors } = gen('UseTileset "main"\nUseTileset "main"\n', fakeAssets())
    expect(errors).toEqual([])
    expect(code.match(/const unsigned char tileset_main\[2048\]/g)?.length).toBe(1)
    expect(code.match(/BC_CHARSET\[_i\] = tileset_main\[_i\]/g)?.length).toBe(2)
  })
})

// ===========================================================================================
//  Pasting small functions into their call sites (INLINE_PLAN T1)
//
//  WHY IT EXISTS, in one measurement: on a real C64 a call costs about 115 cycles before the
//  body does anything (cc65 pushes the argument, jumps, saves and restores its register bank),
//  and Into The Deep's blob loop drops 18,4 % when its three called bodies are written where
//  the calls were. Nothing about the language changes — this is a translation decision.
//
//  Every rule below is a way the paste could have gone WRONG. Each test is the wrong version.
// ===========================================================================================
// ★ ASLEEP, NOT GONE. `INLINE_MAX_STMTS` is 0 — the pass is switched off because measuring it
// on real hardware showed a wash (30 cycles a frame for 733 bytes; see inline.ts for the table
// and the reason). These tests stay exactly as they are and skip themselves, so re-arming the
// pass re-arms its proof at the same moment. The rules that say "this keeps its call" are the
// ones that still run below, since with the pass off everything keeps its call.
describe.skipIf(INLINE_MAX_STMTS === 0)('codegen: pasting small functions into their call sites (INLINE_PLAN T1)', () => {
  it('a body too big stays a call — the win per site is fixed, the size is not', () => {
    // Sized from the RULE, not from a number that happened to be over the line the day this
    // was written: one statement more than the ceiling allows.
    const big = [
      'Function Fett(n.b)',
      ...Array.from({ length: INLINE_MAX_STMTS + 1 }, (_, i) => `  hp${i}.b = n + ${i}`),
      'EndFunction',
      'Fett 3'
    ].join('\n')
    const { code, errors } = gen(big)
    expect(errors).toEqual([])
    expect(code).toContain('Fett(3);')
  })

  it('Return in the middle of a pasted body becomes break, not return', () => {
    // A C `return` here would leave the CALLER. That is the whole reason for the do/while(0).
    const src = [
      'Function Sicher.b(n.b)',
      '  If n = 0 Then Return 0',
      '  Return n',
      'EndFunction',
      'x.b = Sicher(7)'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    const pasted = code.slice(code.indexOf('int main'))
    expect(pasted).toContain('break;')
    expect(pasted).not.toMatch(/\breturn [^0;]/)
  })

  it('two functions in a call cycle keep their calls (a paste would need itself)', () => {
    const src = [
      'Function Ping(n.b)',
      '  Pong n',
      'EndFunction',
      'Function Pong(n.b)',
      '  Ping n',
      'EndFunction',
      'Ping 1'
    ].join('\n')
    const { code } = gen(src)
    expect(code).toContain('Ping(1);')
  })

  it('a record parameter keeps the call: it travels as a pointer, not as a value', () => {
    const src = [
      'Type Slot',
      '  Field item.b',
      'EndType',
      'Dim taschen.Slot[2]',
      'Function Wert.b(s.Slot)',
      '  Return s\\item',
      'EndFunction',
      'x.b = Wert(taschen[0])'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('Wert(&taschen[0])')
  })

  // ---- the positions where hoisting would change WHEN the body runs ----

  it('a While condition keeps its call — it is asked again every round', () => {
    const src = [
      'Function Weiter.b(n.b)',
      '  Return n',
      'EndFunction',
      'While Weiter(1)',
      '  VWait',
      'Wend'
    ].join('\n')
    const { code } = gen(src)
    expect(code).toContain('while (Weiter(1))')
  })

  it('a Repeat…Until condition keeps its call', () => {
    const src = [
      'Function Fertig.b(n.b)',
      '  Return n',
      'EndFunction',
      'Repeat',
      '  VWait',
      'Until Fertig(1)'
    ].join('\n')
    expect(gen(src).code).toContain('while (!(Fertig(1)))')
  })

  it('a For bound keeps its call — it lives in the C loop head', () => {
    const src = [
      'Function Grenze.b(n.b)',
      '  Return n',
      'EndFunction',
      'For i.b = 0 To Grenze(5)',
      '  VWait',
      'Next'
    ].join('\n')
    expect(gen(src).code).toContain('<= Grenze(5)')
  })

  it('an Else If condition keeps its call — its C is `} else if (…)`', () => {
    const src = [
      'Function Trifft.b(n.b)',
      '  Return n',
      'EndFunction',
      'If a.b = 1',
      '  BorderColor 1',
      'Else If Trifft(2)',
      '  BorderColor 2',
      'End If'
    ].join('\n')
    expect(gen(src).code).toContain('} else if (Trifft(2))')
  })

  it('the right-hand side of And keeps its call — C may skip it, a pasted body could not', () => {
    // `X And F()` never calls F when X is false. Pasted in front of the statement the body
    // would run every time: a different cost, and with side effects a different program.
    const src = [
      'Function Trifft.b(n.b)',
      '  Return n',
      'EndFunction',
      'If a.b = 1 And Trifft(2)',
      '  BorderColor 2',
      'End If'
    ].join('\n')
    const { code } = gen(src)
    expect(code).toContain('Trifft(2)')
    expect(code).not.toContain('do {   /* Trifft(')
  })

  it('…but the LEFT side of And is pasted: it is always evaluated', () => {
    const src = [
      'Function Trifft.b(n.b)',
      '  Return n',
      'EndFunction',
      'If Trifft(2) And a.b = 1',
      '  BorderColor 2',
      'End If'
    ].join('\n')
    const { code } = gen(src)
    expect(code).toContain('do {   /* Trifft(')
  })

  // ---- the two ways a NAME could come to mean something else ----

  it('a body reading a global the caller keeps as a local: call, not paste', () => {
    // `takt` is a global the body reads. In the caller it is a LOCAL of the same name, so
    // inside the caller's block the pasted body would read the caller's variable.
    const src = [
      'Global takt.b = 7',
      'Function Lies.b(n.b)',
      '  Return takt + n',
      'EndFunction',
      'Function Ruf.b(n.b)',
      '  takt.b = 1',
      '  Return Lies(n)',
      'EndFunction',
      'x.b = Ruf(2)'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    // Still a real call — that is the rule being asserted. How the argument is SPELLED is
    // not: `Ruf` is itself pasted, so its own parameter carries that paste's prefix (T3).
    expect(code).toMatch(/Lies\((bc_i\d+_)?n\)/)
  })

  it('an argument naming one of the pasted body own names: call, not paste', () => {
    // Pasting would declare the parameter `idx` and then read `idx` for its own initial
    // value — the caller's `idx` would be gone by then.
    const src = [
      'Function Doppel.b(idx.b)',
      '  Return idx + idx',
      'EndFunction',
      'Function Ruf.b(n.b)',
      '  idx.b = n',
      '  Return Doppel(idx)',
      'EndFunction',
      'x.b = Ruf(2)'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toMatch(/Doppel\((bc_i\d+_)?idx\)/)
  })

  it('a local of the pasted body keeps its own name, and the caller keeps its 9', () => {
    // Both name a variable `t`. Under T1 the body's `t` was declared inside the pasted block
    // and shadowed the caller's; since T3 the declarations live at the CALLER's scope, so
    // shadowing is no longer available and the separation has to come from the NAME. That is
    // a stronger guarantee, not a weaker one — but it is a different one, so it is asserted
    // differently: two declarations, two variables, the outer one untouched.
    const src = [
      'Function Klein.b(n.b)',
      '  t.b = n + 1',
      '  Return t',
      'EndFunction',
      't.b = 9',
      'x.b = Klein(2)'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('do {   /* Klein(')
    // the caller's own t, declared and set to 9 …
    expect(code).toContain('unsigned char t = 0;')
    expect(code).toContain('t = 9;')
    // … and the body's t, a variable of its own that nothing else can reach
    expect(code).toMatch(/unsigned char bc_i\d+_t = 0;/)
    expect(code).toMatch(/bc_i\d+_t = \(unsigned char\)\(bc_i\d+_n \+ 1\);/)
  })

  it('a too-big number handed to a pasted parameter still warns', () => {
    const src = [
      'Function Heil(menge.b)',
      '  hp.b = menge',
      'EndFunction',
      'Heil 300'
    ].join('\n')
    // A warning, and exactly ONE: the check runs where the argument is read, and a pasted
    // call reads it once — the same as a real call. (Saying it twice would be the giveaway
    // that the paste kept the call's check as well as its own.)
    const { errors, warnings } = gen(src)
    expect(errors).toEqual([])
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/300/)
  })

  it('★ a body that reaches into a record array is pasted, and its pointer keeps the zero page', () => {
    // ★★★ THIS TEST CHANGED SIDES, AND THE MEASUREMENT IS WHY.
    //
    // It used to assert the opposite: such a body KEPT its call, because pasting it made ITD's
    // blob loop 29 % WORSE (5.676 → 7.341 cycles). The reading of that was "the call buys the
    // body a six-byte register bank, and pasting spends it". Recounted 2026-08-04
    // (`_intern/regbank.test.ts`), and the reading was wrong: main's bank stood EMPTY. The real
    // rule is that cc65 honours `register` only AT FUNCTION SCOPE and ignores it inside a
    // nested block without a word — and a pasted body's declarations sat inside its own
    // `do { … } while (0)`.
    //
    // T3 hoists them to the caller's scope, so the reason for refusing is gone.
    const src = [
      'Type Blob',
      '  Field bx.w',
      '  Field hp.b',
      'EndType',
      'Dim blobs.Blob[3]',
      'Function Schub(idx.b)',
      '  blobs[idx]\\bx = blobs[idx]\\bx + 1',
      'EndFunction',
      'Schub 0'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('do {   /* Schub(')
    // Declared at main's scope — `register` means something only here — and assigned at the
    // site, where the index finally has a value.
    expect(code).toMatch(/register struct Blob \*bc_p_blobs_bc_i\d+_idx = 0;/)
    expect(code).toMatch(/bc_p_blobs_bc_i\d+_idx = &blobs\[bc_i\d+_idx\];/)
    // and nothing is left inside the block that cc65 would refuse a bank for
    expect(code).not.toMatch(/do \{[\s\S]*?register /)
  })

  it('★ several pasted bodies working on the same element share ONE pointer', () => {
    // ★★ THIS IS WHERE THE 27 % IS. Three bodies pasted into one loop round each used to work
    // out their own pointer to `blobs[i]`: three variables, ten bytes asked of a six-byte
    // bank, two of them spilled to the software stack. One pointer fits, so all of them keep
    // the zero page — measured on the real machine, 5.676 → 4.131 cycles.
    //
    // A parameter the body only READS, handed a plain name, IS that name (no copy), so all
    // three arrive at `blobs[i]` and CAN share. The assignment stays at every site: that is
    // what makes the pointer right for THIS round, and what stops any site inheriting an
    // address it did not work out itself.
    const src = [
      'Type Blob',
      '  Field bx.w',
      '  Field hp.b',
      'EndType',
      'Dim blobs.Blob[3]',
      'Function Schub(idx.b)',
      '  blobs[idx]\\bx = blobs[idx]\\bx + 1',
      'EndFunction',
      'Function Heil(idx.b)',
      '  blobs[idx]\\hp = blobs[idx]\\hp + 1',
      'EndFunction',
      'For i.b = 0 To 2',
      '  Schub i',
      '  Heil i',
      'Next'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    // ONE declaration…
    const decls = code.match(/register struct Blob \*bc_p_blobs_i = 0;/g) ?? []
    expect(decls.length).toBe(1)
    // …and both bodies read through it, each after setting it for this round
    const sets = code.match(/bc_p_blobs_i = &blobs\[i\];/g) ?? []
    expect(sets.length).toBe(2)
    expect(code).toContain('bc_p_blobs_i->bx = (bc_p_blobs_i->bx + 1);')
    expect(code).toContain('bc_p_blobs_i->hp = (unsigned char)(bc_p_blobs_i->hp + 1);')
    // ★ the parameter is NOT copied — `idx` IS the caller's `i`, which is what makes it the
    //   same element in both bodies, and so what makes sharing possible at all
    expect(code).not.toMatch(/bc_i\d+_idx = i;/)
  })

  it('…but a parameter the body ASSIGNS is still a copy — CRUMB passes by value', () => {
    // The one thing binding straight through must never do. `Zaehl` moves its parameter; if
    // that were the caller's variable, the caller would find its own number changed.
    // (The caller's variable is deliberately NOT called `n`: an argument that names one of the
    // body's own names keeps its call anyway, by an older rule, and then this would prove
    // nothing about binding.)
    const src = [
      'Function Zaehl.b(n.b)',
      '  n = n + 1',
      '  Return n',
      'EndFunction',
      'zaehler.b = 5',
      'x.b = Zaehl(zaehler)'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toMatch(/bc_i\d+_n = zaehler;/)
    expect(code).toMatch(/bc_i\d+_n = \(unsigned char\)\(bc_i\d+_n \+ 1\);/)
    // and the caller's own number is not what the body counted on
    expect(code).not.toContain('zaehler = (unsigned char)(zaehler + 1);')
  })
})

// ===========================================================================================
//  Dropping a definition nobody calls any more (INLINE_PLAN T2)
//
//  T1 buys speed with bytes: the body now exists at every call site AND as a C function. On a
//  6502 with 38 KB that is not a rounding error — measured on Into The Deep, +2.538 bytes of
//  code. When every call to a function became a pasted body there is no `jsr` left, and the
//  definition is dead weight the RAM bar already promised away.
//
//  It is deliberately the NARROWEST rule that pays that bill back, and the tests below are
//  the three ways a wider one would have been wrong.
// ===========================================================================================
// ★ ASLEEP, NOT GONE. `INLINE_MAX_STMTS` is 0 — the pass is switched off because measuring it
// on real hardware showed a wash (30 cycles a frame for 733 bytes; see inline.ts for the table
// and the reason). These tests stay exactly as they are and skip themselves, so re-arming the
// pass re-arms its proof at the same moment. The rules that say "this keeps its call" are the
// ones that still run below, since with the pass off everything keeps its call.
describe.skipIf(INLINE_MAX_STMTS === 0)('codegen: dropping a definition nobody calls any more (INLINE_PLAN T2)', () => {
  it('a function pasted at its only call site loses its definition, and the C says why', () => {
    const src = ['Function Ping()', '  BorderColor 0', 'EndFunction', 'Ping'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).not.toContain('void Ping(void) {')
    expect(code).toContain('Nicht mehr aufgerufen')
    expect(code).toContain('Ping')
  })

  it('a function nobody ever calls KEEPS its definition — that is not this step’s business', () => {
    // Never called is not the same as no longer called. Dropping it would be a separate
    // decision, and a user who writes a function before its first call should not watch it
    // vanish from the build.
    const src = ['Function Ungenutzt(n.b)', '  hp.b = n', 'EndFunction'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('void Ungenutzt(unsigned char n) {')
    expect(code).not.toContain('Nicht mehr aufgerufen')
  })

  it('one pasted site and one real call: the definition stays', () => {
    // `Mal2` is pasted where it can be and called where it cannot (the right-hand side of
    // And, which C may skip). One surviving call is enough to need the function.
    const src = [
      'Function Mal2.b(n.b)',
      '  Return n + n',
      'EndFunction',
      'x.b = Mal2(3)',
      'If x = 6 And Mal2(2)',
      '  BorderColor 1',
      'End If'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('unsigned char Mal2(unsigned char n) {')
    expect(code).toContain('Mal2(2)')
    expect(code).not.toContain('Nicht mehr aufgerufen')
  })

  it('a function only reached from inside another pasted body still counts as called', () => {
    // `Gross` is too big to paste, so the call inside the pasted `Klein` is a real one — and
    // it has to keep its definition even though nothing in main mentions it.
    const src = [
      'Function Gross(n.b)',
      ...Array.from({ length: INLINE_MAX_STMTS + 1 }, (_, i) => `  hp${i}.b = n + ${i}`),
      'EndFunction',
      'Function Klein(n.b)',
      '  Gross n',
      'EndFunction',
      'Klein 2'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('void Gross(unsigned char n) {')
    expect(code).toMatch(/Gross\((bc_i\d+_)?n\);/)
  })
})

// ===========================================================================================
//  Names that mean something to C, but nothing to you (Review #1, B-5)
//
//  `punkte.b = 1` is a variable. So is `main.b = 1` — to the person writing it. To the C
//  underneath, `main` is the program's entry point, `int` is a type and `register` is a
//  storage class, and handing any of them to cc65 as a variable produces an error about a
//  line of C the user never wrote, in a file they are not meant to read. That is the exact
//  failure the translation doctrine exists to prevent ([[breadcraft-translation-doctrine]]).
//
//  `cName()` already carried the fix; nothing pinned it. These tests do, because a rename
//  rule is precisely the sort of thing a later refactor drops without noticing — the program
//  still compiles, it just stops compiling for the one user who names a variable `char`.
// ===========================================================================================
describe('codegen: a name that is a C keyword is still the user’s name', () => {
  // Each of these is a plain, reasonable thing to call a variable in a game.
  const cases: [string, string][] = [
    ['main', 'the entry point'],
    ['int', 'a type'],
    ['char', 'a type'],
    ['register', 'a storage class'],
    ['switch', 'a statement'],
    ['NULL', 'a macro'],
    ['true', 'a C99 macro']
  ]

  for (const [name, what] of cases) {
    it(`\`${name}\` (in C: ${what}) becomes a variable of its own`, () => {
      const { code, errors } = gen([`${name}.b = 7`, `${name} = ${name} + 1`].join('\n'))
      expect(errors).toEqual([])
      // It is renamed…
      expect(code).toMatch(new RegExp(`unsigned char ${name}_+ = 0;`))
      expect(code).toMatch(new RegExp(`${name}_+ = 7;`))
      // …and the bare word never appears as a declaration, which is what cc65 would choke on.
      expect(code).not.toMatch(new RegExp(`unsigned char ${name} = 0;`))
    })
  }

  it('a FUNCTION may be called `main` too — the same rule, or the C has two of them', () => {
    // Kept too big to paste (INLINE_PLAN), or there is no definition left to look at: a small
    // body is written where it is called and its definition dropped. That is also correct —
    // one entry point, the user's code running — but it proves the T2 rule, not this one.
    const src = [
      'Function main()',
      ...Array.from({ length: INLINE_MAX_STMTS + 1 }, (_, i) => `  BorderColor ${i % 16}`),
      'EndFunction',
      'main'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    // exactly one real entry point…
    expect(code.match(/int main\(void\) \{/g) ?? []).toHaveLength(1)
    // …and the user's function is a different one, called from it
    expect(code).toMatch(/void main_+\(void\)/)
    expect(code).toMatch(/^\s*main_+\(\);/m)
  })

  it('a name in BreadCraft’s own `bc_` namespace is lifted out of it, not left to collide', () => {
    // `bc_camx` is a real generated global in a scrolling world. A user variable of that name
    // would quietly become the same storage — the world would jump when the score changed.
    const { code, errors } = gen(['bc_camx.b = 3', 'bc_camx = bc_camx + 1'].join('\n'))
    expect(errors).toEqual([])
    expect(code).toContain('unsigned char v_bc_camx = 0;')
    expect(code).not.toMatch(/unsigned char bc_camx = 0;/)
  })

  it('the renaming is deterministic — the same name is the same variable everywhere', () => {
    // A rule that renamed per occurrence would compile and then behave wrongly, which is
    // worse than not compiling at all.
    const src = ['int.b = 1', 'Function Zaehl()', '  int = int + 1', 'EndFunction', 'Zaehl'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    const names = [...code.matchAll(/\bint_+\b/g)].map((m) => m[0])
    expect(names.length).toBeGreaterThan(1)
    expect(new Set(names).size).toBe(1)
  })
})

// ===========================================================================================
//  Recursion that goes the long way round (Review #1, B-6)
//
//  `A` calling `A` has been an honest error for a long time. `A → B → A` was not: cc65
//  compiles it without a word and the 6502 walks its stack into the ground at RUNTIME. What
//  reaches the user is a game that freezes, with nothing to read anywhere — the worst kind of
//  failure this project can produce, because there is no thread to pull.
//
//  The ring detector these use is the one the inline pass already needed (a function on a
//  ring can never be pasted), so this diagnostic cost a call, not a second implementation.
// ===========================================================================================
describe('codegen: recursion round a ring is caught before the machine finds it', () => {
  it('A calls B, B calls A — reported, and the message names the way round', () => {
    const src = [
      'Function Pruefe()',
      '  Melde',
      'EndFunction',
      'Function Melde()',
      '  Pruefe',
      'EndFunction',
      'Pruefe'
    ].join('\n')
    const { errors } = gen(src)
    expect(errors).toHaveLength(1)
    // Both legs are named: the user can act on it from whichever function they are reading.
    expect(errors[0]).toMatch(/'Melde' ruft 'Pruefe'/)
    expect(errors[0]).toMatch(/'Pruefe' ruft 'Melde'/)
  })

  it('a ring is reported ONCE, not once per call in it', () => {
    // Two call sites are equally to blame for one circle. Two errors would read as two
    // problems and send the user looking for a second one that does not exist.
    const src = [
      'Function A1()',
      '  B1',
      'EndFunction',
      'Function B1()',
      '  C1',
      'EndFunction',
      'Function C1()',
      '  A1',
      'EndFunction',
      'A1'
    ].join('\n')
    const { errors } = gen(src)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/A1.*B1.*C1|B1.*C1.*A1|C1.*A1.*B1/)
  })

  it('a ring through a VALUE call counts too', () => {
    const src = [
      'Function Wert.b()',
      '  Return Hilf()',
      'EndFunction',
      'Function Hilf.b()',
      '  Return Wert()',
      'EndFunction',
      'x.b = Wert()'
    ].join('\n')
    const { errors } = gen(src)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/Wert|Hilf/)
  })

  it('a direct self-call still gets its own, more precise message', () => {
    // The older diagnostic is better for the simple case — it does not make the user read a
    // ring of one — so the ring check must not swallow it.
    const src = ['Function Endlos()', '  Endlos', 'EndFunction', 'Endlos'].join('\n')
    const { errors } = gen(src)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/ruft sich selbst auf/)
  })

  it('a diamond is NOT a ring — two ways down to the same helper are fine', () => {
    // The shape most likely to produce a false alarm: A calls B and C, both call D. Nothing
    // returns to A, so nothing recurses, and a detector that confused "seen twice" with "on a
    // ring" would reject a perfectly ordinary program.
    const src = [
      'Function D2()',
      '  BorderColor 1',
      'EndFunction',
      'Function B2()',
      '  D2',
      'EndFunction',
      'Function C2()',
      '  D2',
      'EndFunction',
      'Function A2()',
      '  B2',
      '  C2',
      'EndFunction',
      'A2'
    ].join('\n')
    const { errors } = gen(src)
    expect(errors).toEqual([])
  })
})

// ===========================================================================================
//  Dieselbe Karte zweimal zeichnen (2026-08-04)
//
//  An asset's bytes belong to the ASSET, not to the statement that uses them. DrawMap baked
//  them per CALL, so the most ordinary program in the world —
//
//      DrawMap "level01"                   ; Level aufbauen
//      If tot = 1 Then DrawMap "level01"   ; …und nach dem Tod nochmal
//
//  — emitted the array twice, and cc65 refused it:
//
//      Error: Global variable 'map_level01' has already been defined
//
//  An English error about a line of C the user never wrote. Found by the user asking a plain
//  design question ("how would I switch levels?"), which is where this class of bug lives:
//  not in the clever path, in the obvious one.
// ===========================================================================================
describe('codegen: eine Karte wird EINMAL gebacken, beliebig oft gezeichnet', () => {
  // Ein Testprojekt mit mehreren bildschirmgroßen Karten.  hat nur eine —
  // die anderen dort sind absichtlich zu breit für DrawMap (das ist eine WELT).
  const screenMap = (tile: number): string =>
    JSON.stringify({
      format: 'breadcraft.tilemap',
      layers: [
        {
          type: 'grafik',
          tiles: Array.from({ length: 1000 }, () => tile),
          colors: Array.from({ length: 1000 }, () => 1)
        }
      ]
    })
  const charset = JSON.stringify({
    format: 'breadcraft.petscii',
    charCount: 256,
    chars: Array.from({ length: 256 }, () => [0, 0, 0, 0, 0, 0, 0, 0])
  })
  const mapsNamed = (names: string[]): AssetContext => {
    const files: Record<string, string> = { 'main.petscii': charset }
    names.forEach((n, i) => (files[n + '.tilemap'] = screenMap(i + 1)))
    return {
      manifest: {
        palette: null,
        charsets: ['main.petscii'],
        tilemaps: names.map((n) => n + '.tilemap'),
        sprites: [],
        images: []
      },
      readFile: (rel: string) => (rel in files ? files[rel] : null)
    }
  }
  const twoMapAssets = (): AssetContext => mapsNamed(['level1', 'zwei'])
  const clashingAssets = (): AssetContext => mapsNamed(['karte-1', 'karte 1'])

  it('dieselbe Karte zweimal gezeichnet: ein Datenblock, zwei Kopien', () => {
    const src = [
      'UseTileset "main"',
      'DrawMap "level1"',
      'tot.b = 1',
      'If tot = 1 Then DrawMap "level1"'
    ].join('\n')
    const { code, errors } = gen(src, fakeAssets())
    expect(errors).toEqual([])
    // EINE Deklaration je Datenblock — sonst lehnt cc65 das ganze Programm ab …
    expect(code.match(/static const unsigned char map_level1\[/g) ?? []).toHaveLength(1)
    expect(code.match(/static const unsigned char mapcol_level1\[/g) ?? []).toHaveLength(1)
    // … und trotzdem wird zweimal gezeichnet.
    expect(code.match(/BC_SCREEN\[_c\] = map_level1\[_c\]/g) ?? []).toHaveLength(2)
  })

  it('zwei verschiedene Karten bekommen jede ihren eigenen Block', () => {
    // Der Level-Wechsel selbst: das muss weiter zwei Blöcke geben, nicht einen.
    const src = [
      'UseTileset "main"',
      'level.b = 1',
      'If level = 1',
      '  DrawMap "level1"',
      'Else',
      '  DrawMap "zwei"',
      'End If'
    ].join('\n')
    const { code, errors } = gen(src, twoMapAssets())
    expect(errors).toEqual([])
    expect(code.match(/static const unsigned char map_level1\[/g) ?? []).toHaveLength(1)
    expect(code.match(/static const unsigned char map_zwei\[/g) ?? []).toHaveLength(1)
  })

  it('★ zwei Karten, deren Namen intern gleich werden, sind ein ehrlicher Fehler', () => {
    // `karte-1` und `karte 1` werden beide zu `map_karte_1`. Den zweiten Bake still zu
    // überspringen wäre SCHLIMMER als der Compilerfehler von vorher: gezeichnet würde die
    // erste Karte unter dem Namen der zweiten — ein falsches Bild statt eines kaputten Builds.
    const src = ['UseTileset "main"', 'DrawMap "karte-1"', 'DrawMap "karte 1"'].join('\n')
    const { errors } = gen(src, clashingAssets())
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/karte-1|karte 1/)
    expect(errors[0]).toMatch(/map_karte_1/)
  })
  it('derselbe Zeichensatz nach einem Wechsel: auch nur ein Datenblock', () => {
    // Gefunden beim DrawMap-Fix: der alte Schutz fragte nur „ist es DASSELBE wie zuletzt?",
    // also rutschte a → b → a durch und cc65 lehnte das Programm ab. Ein Titelbild mit
    // eigenem Zeichensatz und danach zurück ins Spiel ist genau dieser Ablauf.
    const src = ['UseTileset "main"', 'UseTileset "zweit"', 'UseTileset "main"'].join('\n')
    const { code, errors } = gen(src, twoCharsetAssets())
    expect(errors).toEqual([])
    expect(code.match(/static const unsigned char tileset_main\[/g) ?? []).toHaveLength(1)
    expect(code.match(/static const unsigned char tileset_zweit\[/g) ?? []).toHaveLength(1)
    // …und der VIC wird trotzdem dreimal umgehängt
    expect((code.match(/VIC\.addr = /g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  const twoCharsetAssets = (): AssetContext => {
    const cs = (v: number): string =>
      JSON.stringify({
        format: 'breadcraft.petscii',
        charCount: 256,
        chars: Array.from({ length: 256 }, () => [v, 0, 0, 0, 0, 0, 0, 0])
      })
    const files: Record<string, string> = { 'main.petscii': cs(1), 'zweit.petscii': cs(2) }
    return {
      manifest: {
        palette: null,
        charsets: ['main.petscii', 'zweit.petscii'],
        tilemaps: [],
        sprites: [],
        images: []
      },
      readFile: (rel: string) => (rel in files ? files[rel] : null)
    }
  }
})

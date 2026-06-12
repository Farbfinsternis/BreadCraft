import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile } from '../index'
import type { AssetContext } from '../codegen'

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

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
    layers: [{ type: 'grafik', tiles: Array.from({ length: 1000 }, (_, i) => (i === 0 ? 1 : 0)) }]
  })
  // Two frames so a test can confirm UseSprite bakes ONLY frame 0.
  const sprite = JSON.stringify({
    format: 'breadcraft.sprite',
    frames: [
      Array.from({ length: 63 }, (_, i) => (i === 0 ? 0xff : i === 62 ? 0x42 : 0)),
      Array.from({ length: 63 }, () => 0x99)
    ]
  })
  const files: Record<string, string> = {
    'main.petscii': charset,
    'level1.tilemap': tilemap,
    'player.sprite': sprite
  }
  return {
    manifest: {
      palette: null,
      charsets: ['main.petscii'],
      tilemaps: ['level1.tilemap'],
      sprites: ['player.sprite']
    },
    readFile: (rel: string) => (rel in files ? files[rel] : null)
  }
}

describe('codegen: program frame', () => {
  it('emits the conio/c64 header and a main() function', () => {
    const { code, errors } = gen('Graphics TEXT')
    expect(errors).toEqual([])
    expect(code).toContain('#include <conio.h>')
    expect(code).toContain('#include <cbm.h>')
    expect(code).toContain('int main(void) {')
    expect(code).toContain('return 0;')
  })
})

describe('codegen: setup commands → conio', () => {
  it('maps BorderColor / Cls / DrawText with color macros', () => {
    const src = ['Graphics TEXT', 'BorderColor BLACK', 'Cls BLUE', 'DrawText 0, 0, "HI"'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('bordercolor(COLOR_BLACK);')
    expect(code).toContain('bgcolor(COLOR_BLUE);')
    expect(code).toContain('clrscr();')
    expect(code).toContain('cputsxy(0, 0, "HI");')
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

describe('codegen: Graphics mode + VWait (Stufe 2, §E/§F)', () => {
  it('maps VWait to waitvsync()', () => {
    const { code } = gen('VWait')
    expect(code).toContain('waitvsync();')
  })

  it('Graphics TEXT, MULTICOLOR sets the MCM bit, clears BMM (text)', () => {
    const { code, errors } = gen('Graphics TEXT, MULTICOLOR')
    expect(errors).toEqual([])
    expect(code).toContain('VIC.ctrl2 |= 0x10;') // multicolor on
    expect(code).toContain('VIC.ctrl1 &= ~0x20;') // text (not bitmap)
  })

  it('Graphics TEXT, HIRES clears both mode bits', () => {
    const { code } = gen('Graphics TEXT, HIRES')
    expect(code).toContain('VIC.ctrl2 &= ~0x10;') // hires (not multicolor)
    expect(code).toContain('VIC.ctrl1 &= ~0x20;') // text
  })

  it('Graphics BITMAP, MULTICOLOR sets both mode bits', () => {
    const { code } = gen('Graphics BITMAP, MULTICOLOR')
    expect(code).toContain('VIC.ctrl1 |= 0x20;') // bitmap
    expect(code).toContain('VIC.ctrl2 |= 0x10;') // multicolor
  })

  it('Graphics TEXT alone defaults to HIRES (color mode optional)', () => {
    const { code, errors } = gen('Graphics TEXT')
    expect(errors).toEqual([])
    expect(code).toContain('VIC.ctrl2 &= ~0x10;')
  })

  it('rejects BITMAP, HIRES (not a Phase-1 mode)', () => {
    const { errors } = gen('Graphics BITMAP, HIRES')
    expect(errors.some((e) => /nicht vorgesehen/.test(e))).toBe(true)
  })
})

describe('codegen: honest failure (no crash)', () => {
  it('reports a command without a C mapping yet, leaves a TODO marker', () => {
    // DrawImage isn't mapped yet (bitmap mode, a later layer) — the generic
    // "no C-mapping" path still reports honestly and leaves a TODO marker.
    const { code, errors } = gen('DrawImage "title"')
    expect(errors.some((e) => /DrawImage/.test(e))).toBe(true)
    expect(code).toContain('/* TODO: DrawImage')
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

  it('TileSolid emits the solid helper (default table) and calls it', () => {
    const { code, errors } = gen('blocked.b = TileSolid(120, 100)')
    expect(errors).toEqual([])
    expect(code).toContain('static unsigned char bc_tile_solid_at(')
    expect(code).toContain('return bc_tile_at(px, py) != 0;') // default: tile 0 passable
    expect(code).toContain('blocked = bc_tile_solid_at(120, 100);')
  })

  it('strength-reduces the ×40 in bc_tile_at to shifts (per-pixel collision hot path)', () => {
    // 40 (the screen width) is not a power of two, so a literal row*40 is cc65's slow
    // software multiply. The tile lookup runs once per pixel during movement, so it uses
    // the shift/add chain (40 = 32 + 8 → (row<<5)+(row<<3)) like the 2D-array index does.
    const { code } = gen('blocked.b = TileSolid(120, 100)')
    expect(code).toContain('(((row) << 5) + ((row) << 3))')
    expect(code).not.toContain('row * BC_SCR_W')
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

  it('a value call in an expression maps to a C call', () => {
    const src = [
      'Function Dbl.b(n.b)',
      '  Return n + n',
      'EndFunction',
      'x.b = Dbl(5)'
    ].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('x = Dbl(5);')
  })

  it('a statement call (no parens) maps to a C call statement', () => {
    const src = ['Function Ping()', '  BorderColor 0', 'EndFunction', 'Ping'].join('\n')
    const { code, errors } = gen(src)
    expect(errors).toEqual([])
    expect(code).toContain('Ping();')
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
    expect(code).toContain('return (s->item + s->count);') // M1.T1: always-parens
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
    expect(code).toContain('VIC.spr_hi_x |= (1 << (s))')
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

  it('marks sprite use in the header (asset-baking seam) only when used', () => {
    const { code } = gen('Sprite 0, 100, 100')
    expect(code).toContain('/* sprites: positions/enable via VIC registers (c64.h) */')
    expect(gen('x.b = 1').code).not.toContain('/* sprites:')
  })

  it('Sprite with too few args fails honestly', () => {
    const { errors } = gen('Sprite 0, 100')
    expect(errors.some((e) => /Sprite erwartet/.test(e))).toBe(true)
  })

})

describe('codegen: UseSprite (P2.T3) — bake a painted sprite into the program', () => {
  it('bakes frame 0, copies it to the slot block, points the slot', () => {
    const { code, errors } = gen('UseSprite 0, "player"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('static const unsigned char sprite_player[63]')
    // frame 0 bytes (255 … 0x42), NOT frame 1 (all 0x99)
    expect(code).toMatch(/255,/)
    expect(code).toContain('66') // 0x42 = 66, the last byte of frame 0
    expect(code).not.toMatch(/153, 153, 153/) // 0x99 = 153 (frame 1) must not appear
    expect(code).toContain('_d = BC_SPR_DATA(0)')
    expect(code).toContain('_d[_s] = sprite_player[_s]')
    expect(code).toContain('BC_SPR_PTR[0] = BC_SPR_BLOCK0 + (0);')
  })

  it('emits the sprite-data memory-map defines in the header when used', () => {
    const { code } = gen('UseSprite 0, "player"', fakeAssets())
    expect(code).toContain('#define BC_SPR_DATA(n)')
    expect(code).toContain('#define BC_SPR_PTR')
    expect(code).toContain('#define BC_SPR_BLOCK0')
  })

  it('sets the multicolor bit + shared registers (from the default palette) in MULTICOLOR mode', () => {
    // fakeAssets has no .palette → DEFAULT_PALETTE (shared1=brown, shared2=lightblue).
    const { code, errors } = gen('Graphics TEXT, MULTICOLOR\nUseSprite 1, "player"', fakeAssets())
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
    const { code, errors } = gen('Graphics TEXT, MULTICOLOR\nUseSprite 0, "player"', withPal)
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_mcolor0 = COLOR_RED;') // shared1 = 2
    expect(code).toContain('VIC.spr_mcolor1 = COLOR_YELLOW;') // shared2 = 7
  })

  it('clears the multicolor bit in HIRES mode', () => {
    const { code, errors } = gen('Graphics TEXT, HIRES\nUseSprite 0, "player"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('VIC.spr_mcolor &= ~(1 << (0));')
    expect(code).not.toContain('VIC.spr_mcolor0 =')
  })

  it('accepts a variable slot (expression, runtime-safe block math)', () => {
    const { code, errors } = gen(['s.b = 3', 'UseSprite s, "player"'].join('\n'), fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('_d = BC_SPR_DATA(s)')
    expect(code).toContain('BC_SPR_PTR[s] = BC_SPR_BLOCK0 + (s);')
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
  it('bakes the charset bytes, points VIC at $3000, sets MC colours', () => {
    const { code, errors } = gen('UseTileset "main"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('static const unsigned char tileset_main[2048]')
    expect(code).toMatch(/1, 2, 3, 4, 5, 6, 7, 8/) // char 1 bytes baked
    expect(code).toContain('BC_CHARSET[_i] = tileset_main[_i]')
    expect(code).toContain('VIC.addr = 0x1C;')
    expect(code).toContain('#define BC_CHARSET')
  })

  it('bakes the map tiles and copies them into screen RAM', () => {
    const { code, errors } = gen('UseTileset "main"\nDrawMap "level1"', fakeAssets())
    expect(errors).toEqual([])
    expect(code).toContain('static const unsigned char map_level1[1000]')
    expect(code).toContain('BC_SCREEN[_c] = map_level1[_c]')
    expect(code).toContain('COLOR_RAM[_c]')
  })

  it('errors honestly when DrawMap has no active tileset', () => {
    const { errors } = gen('DrawMap "level1"', fakeAssets())
    expect(errors.some((e) => /kein Tileset aktiv/.test(e))).toBe(true)
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
})

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

/** A fake asset context: one charset ("main") + one tilemap ("level1"), in memory. */
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
  const files: Record<string, string> = { 'main.petscii': charset, 'level1.tilemap': tilemap }
  return {
    manifest: { charsets: ['main.petscii'], tilemaps: ['level1.tilemap'] },
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
    expect(block).toContain('if (x > 10) {')
    expect(block).toContain('} else {')

    const oneLine = gen('If x > 10 Then DrawText 0,0,"a"').code
    expect(oneLine).toContain('if (x > 10) {')
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

describe('codegen: expressions', () => {
  it('respects precedence and maps operators', () => {
    const { code } = gen('score.w = 10 + 5 * 2')
    expect(code).toContain('score = 10 + 5 * 2;')
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

  it('accepts a Const whose name collides with an SSOT word (M3.T0a)', () => {
    // MAX is the Max function in the SSOT; LEFT a direction constant. As Const names
    // they must compile cleanly through lex → parse → codegen (no parse error).
    const { code, errors } = gen('Const MAX = 5\nConst LEFT = 1')
    expect(errors).toEqual([])
    expect(code).toContain('#define MAX (5)')
    expect(code).toContain('#define LEFT (1)')
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
    // Sprite isn't mapped yet (M3.T2) — the honest "no mapping" path still works.
    const { code, errors } = gen('Sprite 0, 100, 100')
    expect(errors.some((e) => /Sprite/.test(e))).toBe(true)
    expect(code).toContain('/* TODO: Sprite')
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

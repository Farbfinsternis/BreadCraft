import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { tokenize } from '../lexer'
import { parse } from './index'
import type {
  Program,
  Statement,
  Expr,
  Binary,
  CommandStmt,
  AssignStmt,
  GlobalStmt,
  ConstStmt,
  DimStmt,
  TypeDecl,
  Identifier,
  IndexExpr,
  FieldExpr,
  IfStmt,
  WhileStmt,
  RepeatStmt,
  ForStmt
} from './index'

// Lexer + parser together, against the REAL SSOT vocabulary.
const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

function parseSrc(src: string): { program: Program; errors: string[] } {
  const { program, errors } = parse(tokenize(src, vocab))
  return { program, errors: errors.map((e) => `${e.line}:${e.col} ${e.message}`) }
}

/** First statement, asserting no parse errors. */
function firstStmt(src: string): Statement {
  const { program, errors } = parseSrc(src)
  expect(errors).toEqual([])
  expect(program.body.length).toBeGreaterThan(0)
  return program.body[0]
}

describe('parser: command statements', () => {
  it('parses  Graphics TEXT  (command + constant arg)', () => {
    const s = firstStmt('Graphics TEXT') as CommandStmt
    expect(s.kind).toBe('CommandStmt')
    expect(s.name).toBe('Graphics')
    expect(s.args).toHaveLength(1)
    expect(s.args[0].kind).toBe('ConstantRef')
    expect((s.args[0] as { name: string }).name).toBe('TEXT')
  })

  it('parses  DrawText 5, 5, "HELLO BREADCRAFT"  (3 args)', () => {
    const s = firstStmt('DrawText 5, 5, "HELLO BREADCRAFT"') as CommandStmt
    expect(s.kind).toBe('CommandStmt')
    expect(s.name).toBe('DrawText')
    expect(s.args.map((a) => a.kind)).toEqual(['NumberLit', 'NumberLit', 'StringLit'])
    expect(s.line).toBe(1)
    expect(s.col).toBe(1)
  })

  it('accepts optional parentheses around the argument list', () => {
    const s = firstStmt('BorderColor(BLACK)') as CommandStmt
    expect(s.kind).toBe('CommandStmt')
    expect(s.args).toHaveLength(1)
    expect(s.args[0].kind).toBe('ConstantRef')
  })
})

describe('parser: assignments and expression precedence', () => {
  it('parses  score.w = 10 + 5 * 2  with * binding tighter than +', () => {
    const s = firstStmt('score.w = 10 + 5 * 2') as AssignStmt
    expect(s.kind).toBe('AssignStmt')
    const target = s.target as Identifier
    expect(target.name).toBe('score')
    expect(target.suffix).toBe('.w')
    const v = s.value as Binary
    expect(v.kind).toBe('Binary')
    expect(v.op).toBe('+')
    expect((v.left as { raw: string }).raw).toBe('10')
    const r = v.right as Binary
    expect(r.kind).toBe('Binary')
    expect(r.op).toBe('*') // 5 * 2 grouped under +
  })

  it('honours parentheses: (1 + 2) * 3 ≠ 1 + 2 * 3', () => {
    const grouped = (firstStmt('x = (1 + 2) * 3') as AssignStmt).value as Binary
    expect(grouped.op).toBe('*')
    expect(grouped.left.kind).toBe('Grouping')

    const flat = (firstStmt('x = 1 + 2 * 3') as AssignStmt).value as Binary
    expect(flat.op).toBe('+') // top operator is + when unparenthesised
  })

  it('comparison binds tighter than And:  a > 1 And b < 2', () => {
    const v = (firstStmt('x = a > 1 And b < 2') as AssignStmt).value as Binary
    expect(v.op.toLowerCase()).toBe('and')
    expect((v.left as Binary).op).toBe('>')
    expect((v.right as Binary).op).toBe('<')
  })

  it('parses a function call in an expression:  n$ = Left$(s$, 3)', () => {
    const s = firstStmt('n$ = Left$(s$, 3)') as AssignStmt
    expect((s.target as Identifier).suffix).toBe('$')
    const call = s.value as Expr & { kind: string; callee?: string; args?: Expr[] }
    expect(call.kind).toBe('CallExpr')
    expect(call.callee).toBe('Left$')
    expect(call.args).toHaveLength(2)
  })

  it('reads hex and binary number literals', () => {
    const hex = (firstStmt('x = $FF') as AssignStmt).value as { base: string; raw: string }
    expect(hex.base).toBe('hex')
    expect(hex.raw).toBe('FF')
    const bin = (firstStmt('x = %1010') as AssignStmt).value as { base: string }
    expect(bin.base).toBe('bin')
  })
})

describe('parser: separators and comments', () => {
  it('ignores a trailing ; comment', () => {
    const { program, errors } = parseSrc('DrawText 0, 0, "x" ; das HUD')
    expect(errors).toEqual([])
    expect(program.body).toHaveLength(1)
    expect(program.body[0].kind).toBe('CommandStmt')
  })

  it('splits multiple statements on one line via :', () => {
    const { program, errors } = parseSrc('Graphics TEXT : BorderColor BLACK')
    expect(errors).toEqual([])
    expect(program.body.map((s) => s.kind)).toEqual(['CommandStmt', 'CommandStmt'])
  })

  it('parses statements across newlines', () => {
    const { program } = parseSrc('Graphics TEXT\nDrawText 0, 0, "HI"')
    expect(program.body).toHaveLength(2)
  })
})

describe('parser: error handling (never throws, recovers)', () => {
  it('reports a not-yet-supported keyword (Select) with position, keeps going', () => {
    // Select/Case is a later layer; it must fail honestly, not silently, and the
    // following valid statement must still be parsed.
    const { program, errors } = parseSrc('Select x\nDrawText 0, 0, "ok"')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0]).toMatch(/1:1/)
    expect(errors[0]).toMatch(/Select/)
    const cmds = program.body.filter((s) => s.kind === 'CommandStmt')
    expect(cmds).toHaveLength(1)
  })
})

describe('parser: declarations (Global / Const)', () => {
  it('parses  Global score.w = 0  with the type suffix on the target', () => {
    const s = firstStmt('Global score.w = 0') as GlobalStmt
    expect(s.kind).toBe('GlobalStmt')
    expect(s.target.name).toBe('score')
    expect(s.target.suffix).toBe('.w')
    expect(s.value.kind).toBe('NumberLit')
  })

  it('reports a missing init on Global (mandatory), recovers', () => {
    const { errors } = parseSrc('Global score.w\nDrawText 0, 0, "ok"')
    expect(errors.some((e) => /Pflicht-Initialisierung/.test(e))).toBe(true)
  })

  it('parses  Const MAXLIVES = 3  (no suffix, a name + value)', () => {
    const s = firstStmt('Const MAXLIVES = 3') as ConstStmt
    expect(s.kind).toBe('ConstStmt')
    expect(s.name).toBe('MAXLIVES')
    expect(s.value.kind).toBe('NumberLit')
  })

  it('parses a 1D  Dim punkte.b[10]', () => {
    const s = firstStmt('Dim punkte.b[10]') as DimStmt
    expect(s.kind).toBe('DimStmt')
    expect(s.target.name).toBe('punkte')
    expect(s.target.suffix).toBe('.b')
    expect(s.sizes).toHaveLength(1)
    expect((s.sizes[0] as { raw: string }).raw).toBe('10')
  })

  it('parses a 2D  Dim feld.b[40, 25]', () => {
    const s = firstStmt('Dim feld.b[40, 25]') as DimStmt
    expect(s.kind).toBe('DimStmt')
    expect(s.sizes).toHaveLength(2)
    expect((s.sizes[0] as { raw: string }).raw).toBe('40')
    expect((s.sizes[1] as { raw: string }).raw).toBe('25')
  })

  it('reports a missing size on Dim, recovers', () => {
    const { errors } = parseSrc('Dim feld.b\nDrawText 0, 0, "ok"')
    expect(errors.some((e) => /\[/.test(e))).toBe(true)
  })

  it('rejects 3+ dimensions with a cost-honest message (C64 has no HW multiply)', () => {
    const { errors } = parseSrc('Dim welt.b[40, 25, 10]')
    expect(errors.some((e) => /1- und 2-dimensionale/.test(e))).toBe(true)
  })
})

describe('parser: array element access (IndexExpr)', () => {
  it('parses a 2D element on the right-hand side:  x.b = feld[s, z]', () => {
    const s = firstStmt('x.b = feld[s, z]') as AssignStmt
    const idx = s.value as IndexExpr
    expect(idx.kind).toBe('IndexExpr')
    expect(idx.name).toBe('feld')
    expect(idx.indices).toHaveLength(2)
  })

  it('parses an array element as the assignment target:  feld[s, z] = 1', () => {
    const s = firstStmt('feld[s, z] = 1') as AssignStmt
    expect(s.kind).toBe('AssignStmt')
    const target = s.target as IndexExpr
    expect(target.kind).toBe('IndexExpr')
    expect(target.name).toBe('feld')
    expect(target.indices).toHaveLength(2)
  })
})

describe('parser: records (Type/Field/EndType, backslash access)', () => {
  it('parses a Type … Field … EndType block', () => {
    const src = ['Type Slot', '  Field item.b', '  Field count.w', 'EndType'].join('\n')
    const s = firstStmt(src) as TypeDecl
    expect(s.kind).toBe('TypeDecl')
    expect(s.name).toBe('Slot')
    expect(s.fields).toHaveLength(2)
    expect(s.fields[0]).toEqual({ name: 'item', suffix: '.b' })
    expect(s.fields[1]).toEqual({ name: 'count', suffix: '.w' })
  })

  it('parses a record field access on the right-hand side: x.b = t[3]\\count', () => {
    const src = ['Type Slot', '  Field count.b', 'EndType', 'x.b = t[3]\\count'].join('\n')
    const { program, errors } = parseSrc(src)
    expect(errors).toEqual([])
    const assign = program.body.find((st) => st.kind === 'AssignStmt') as AssignStmt
    const fld = assign.value as FieldExpr
    expect(fld.kind).toBe('FieldExpr')
    expect(fld.field).toBe('count')
    expect((fld.base as IndexExpr).kind).toBe('IndexExpr')
  })

  it('parses a record field as the assignment target: t[3]\\count = 5', () => {
    const src = ['Type Slot', '  Field count.b', 'EndType', 't[3]\\count = 5'].join('\n')
    const { program, errors } = parseSrc(src)
    expect(errors).toEqual([])
    const assign = program.body.find((st) => st.kind === 'AssignStmt') as AssignStmt
    const target = assign.target as FieldExpr
    expect(target.kind).toBe('FieldExpr')
    expect(target.field).toBe('count')
  })
})

describe('parser: control flow (2b)', () => {
  it('parses a single-line If … Then <stmt>', () => {
    const s = firstStmt('If Joystick(LEFT) Then px.w = px - 1') as IfStmt
    expect(s.kind).toBe('IfStmt')
    expect(s.cond.kind).toBe('CallExpr') // Joystick(LEFT)
    expect(s.then).toHaveLength(1)
    expect(s.then[0].kind).toBe('AssignStmt')
    expect(s.elifs).toHaveLength(0)
    expect(s.else).toBeUndefined()
  })

  it('parses a block If … ElseIf … Else … EndIf', () => {
    const src = [
      'If x > 10',
      '  DrawText 0, 0, "big"',
      'ElseIf x > 5',
      '  DrawText 0, 0, "mid"',
      'Else',
      '  DrawText 0, 0, "small"',
      'EndIf'
    ].join('\n')
    const s = firstStmt(src) as IfStmt
    expect(s.kind).toBe('IfStmt')
    expect(s.then).toHaveLength(1)
    expect(s.elifs).toHaveLength(1)
    expect(s.elifs[0].body).toHaveLength(1)
    expect(s.else).toHaveLength(1)
  })

  it('parses the frame loop While 1 … Wend', () => {
    const s = firstStmt('While 1\n  DrawText 0, 0, "hi"\nWend') as WhileStmt
    expect(s.kind).toBe('WhileStmt')
    expect((s.cond as { raw?: string }).raw).toBe('1')
    expect(s.body).toHaveLength(1)
    expect(s.body[0].kind).toBe('CommandStmt')
  })

  it('parses For i = 0 To 9 … Next (no Step)', () => {
    const s = firstStmt('For i = 0 To 9\n  DrawText 0, 0, "x"\nNext') as ForStmt
    expect(s.kind).toBe('ForStmt')
    expect(s.variable.name).toBe('i')
    expect((s.from as { raw?: string }).raw).toBe('0')
    expect((s.to as { raw?: string }).raw).toBe('9')
    expect(s.step).toBeUndefined()
    expect(s.body).toHaveLength(1)
  })

  it('parses For … To … Step …', () => {
    const s = firstStmt('For i = 0 To 10 Step 2\nNext') as ForStmt
    expect(s.step).toBeDefined()
    expect((s.step as { raw?: string }).raw).toBe('2')
  })

  it('parses Repeat … Until cond', () => {
    const s = firstStmt('Repeat\n  DrawText 0, 0, "x"\nUntil done') as RepeatStmt
    expect(s.kind).toBe('RepeatStmt')
    expect(s.body).toHaveLength(1)
    expect(s.until.kind).toBe('Identifier')
  })

  it('parses Exit inside a While body', () => {
    const s = firstStmt('While 1\n  Exit\nWend') as WhileStmt
    expect(s.body).toHaveLength(1)
    expect(s.body[0].kind).toBe('ExitStmt')
  })

  it('nests If inside While inside For', () => {
    const src = [
      'For i = 0 To 9',
      '  While 1',
      '    If i > 5 Then Exit',
      '  Wend',
      'Next'
    ].join('\n')
    const forS = firstStmt(src) as ForStmt
    expect(forS.kind).toBe('ForStmt')
    const whileS = forS.body[0] as WhileStmt
    expect(whileS.kind).toBe('WhileStmt')
    const ifS = whileS.body[0] as IfStmt
    expect(ifS.kind).toBe('IfStmt')
    expect(ifS.then[0].kind).toBe('ExitStmt')
  })

  it('reports a missing Wend with position, does not crash', () => {
    const { program, errors } = parseSrc('While 1\n  DrawText 0, 0, "x"')
    expect(errors.some((e) => /Wend/.test(e))).toBe(true)
    // The While still produced a node (with the body it could read).
    expect(program.body[0].kind).toBe('WhileStmt')
  })
})

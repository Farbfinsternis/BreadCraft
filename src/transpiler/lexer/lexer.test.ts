import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { tokenize, TokenType, type Token } from './index'

// Tests run against the REAL SSOT vocabulary so they verify the lexer against the
// actual BreadCraft language, not a hand-rolled mock. A tiny mock vocab is used
// only where we want to assert a specific classification in isolation.
const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

/** Token types with trivia stripped, for compact stream assertions. */
function types(tokens: Token[]): TokenType[] {
  return tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type)
}

describe('lexer: basics', () => {
  it('emits only EOF for empty input', () => {
    const t = tokenize('', vocab)
    expect(t).toHaveLength(1)
    expect(t[0].type).toBe(TokenType.EOF)
  })

  it('skips spaces and tabs but keeps newlines as tokens', () => {
    const t = tokenize('5\t6\n7', vocab)
    expect(types(t)).toEqual([
      TokenType.NumberDec,
      TokenType.NumberDec,
      TokenType.Newline,
      TokenType.NumberDec
    ])
  })

  it('always terminates the stream with EOF', () => {
    const t = tokenize('Text', vocab)
    expect(t[t.length - 1].type).toBe(TokenType.EOF)
  })
})

describe('lexer: comments and strings', () => {
  it('treats ; ... to end of line as a comment (Sprachdef §B)', () => {
    const t = tokenize('; hallo welt', vocab)
    expect(t[0].type).toBe(TokenType.Comment)
    expect(t[0].value).toBe(' hallo welt')
  })

  it('lexes code before a trailing ; comment, then the comment', () => {
    const t = tokenize('DrawText 0, 0, "x" ; hud', vocab)
    expect(t[0].type).toBe(TokenType.Command)
    const c = t.find((x) => x.type === TokenType.Comment)!
    expect(c.value).toBe(' hud')
  })

  it("a lone ' is no longer special (Error token)", () => {
    const t = tokenize("'", vocab)
    expect(t[0].type).toBe(TokenType.Error)
  })

  it('reads a string without its quotes', () => {
    const t = tokenize('"HELLO"', vocab)
    expect(t[0].type).toBe(TokenType.String)
    expect(t[0].value).toBe('HELLO')
    expect(t[0].length).toBe(7) // includes both quotes
  })

  it('emits an Error token for an unterminated string (no throw)', () => {
    const t = tokenize('"oops', vocab)
    expect(t[0].type).toBe(TokenType.Error)
    expect(t[0].error).toBeTruthy()
  })
})

describe('lexer: numbers', () => {
  it('reads decimal, hex ($) and binary (%) numbers', () => {
    const t = tokenize('42 $FF %1010', vocab)
    expect(types(t)).toEqual([
      TokenType.NumberDec,
      TokenType.NumberHex,
      TokenType.NumberBin
    ])
    expect(t[0].value).toBe('42')
    expect(t[1].value).toBe('FF')
    expect(t[2].value).toBe('1010')
  })
})

describe('lexer: SSOT classification', () => {
  it('classifies Graphics as a Command and TEXT as a Constant', () => {
    const t = tokenize('Graphics TEXT', vocab)
    expect(types(t)).toEqual([TokenType.Command, TokenType.Constant])
  })

  it('is case-insensitive (graphics == Graphics)', () => {
    const t = tokenize('graphics', vocab)
    expect(t[0].type).toBe(TokenType.Command)
  })

  it('leaves unknown words as plain identifiers', () => {
    const t = tokenize('wibbleflop', vocab)
    expect(t[0].type).toBe(TokenType.Identifier)
  })

  it('prefers Constant when a name is both constant and command/function', () => {
    // TEXT exists in the SSOT both as the graphics-mode constant and elsewhere;
    // the lexer resolves the collision to Constant (documented in lexer.ts).
    const t = tokenize('TEXT', vocab)
    expect(t[0].type).toBe(TokenType.Constant)
  })
})

describe('lexer: type suffixes (.b / .w / $) on variables', () => {
  it('splits a $ suffix off an unknown identifier (string variable)', () => {
    const t = tokenize('name$', vocab)
    expect(types(t)).toEqual([TokenType.Identifier, TokenType.TypeSuffix])
    expect(t[0].value).toBe('name')
    expect(t[1].value).toBe('$')
  })

  it('splits .b and .w suffixes off an identifier', () => {
    expect(types(tokenize('score.b', vocab))).toEqual([
      TokenType.Identifier,
      TokenType.TypeSuffix
    ])
    expect(types(tokenize('big.w', vocab))).toEqual([
      TokenType.Identifier,
      TokenType.TypeSuffix
    ])
  })

  it('does not mistake .bonus for the .b suffix (more ident chars follow)', () => {
    // `.b` is only a suffix when nothing identifier-like follows the b — so `.bonus`
    // is NOT `.b` + `onus`. Since `bonus` is not a known record, the dot stays
    // unattached: identifier `feld`, then an Error token for the lone '.'.
    const t = tokenize('feld.bonus', vocab)
    expect(t[0].type).toBe(TokenType.Identifier)
    expect(t[0].value).toBe('feld')
    expect(t[1].type).not.toBe(TokenType.TypeSuffix)
  })
})

describe('lexer: records (Type/Field/EndType, backslash field access)', () => {
  it('lexes a record type suffix .Slot when Slot is a known Type', () => {
    const src = ['Type Slot', '  Field item.b', 'EndType', 'Dim t.Slot[5]'].join('\n')
    const t = tokenize(src, vocab).filter((x) => x.type !== TokenType.Newline)
    // find the `t` identifier before the `.Slot` suffix
    const sfx = t.find((x) => x.type === TokenType.TypeSuffix && x.value === '.Slot')
    expect(sfx).toBeDefined()
  })

  it('does NOT treat .Unknown as a suffix when no such record exists', () => {
    const t = tokenize('Dim t.Unknown[5]', vocab)
    expect(t.some((x) => x.type === TokenType.TypeSuffix && x.value === '.Unknown')).toBe(false)
  })

  it('lexes the backslash field access as a Backslash token', () => {
    const src = ['Type Slot', '  Field count.b', 'EndType', 'x.b = t[3]\\count'].join('\n')
    const t = tokenize(src, vocab)
    expect(t.some((x) => x.type === TokenType.Backslash)).toBe(true)
  })
})

describe('lexer: $ as part of a canonical function name (collision fix)', () => {
  // Left/Right collided case-insensitively with the JoyDir constants LEFT/RIGHT.
  // The fix: the string functions carry the BASIC $ suffix (Left$, Right$, …).
  // The lexer must keep `Left$` as ONE Function token (not Identifier+suffix),
  // because the SSOT knows `left$` as a word — while bare LEFT stays a Constant.
  it('lexes Left$ / Right$ / Mid$ / Chr$ as single Function tokens', () => {
    for (const fn of ['Left$', 'Right$', 'Mid$', 'Chr$', 'Str$']) {
      const t = tokenize(fn, vocab)
      expect(t[0].type, fn).toBe(TokenType.Function)
      expect(t[0].value, fn).toBe(fn)
      expect(t[1].type, fn).toBe(TokenType.EOF) // exactly one token, no split
    }
  })

  it('still lexes bare LEFT / RIGHT as the JoyDir Constants', () => {
    expect(tokenize('LEFT', vocab)[0].type).toBe(TokenType.Constant)
    expect(tokenize('RIGHT', vocab)[0].type).toBe(TokenType.Constant)
  })

  it('handles Left$ in a realistic call: Left$(s$, 3)', () => {
    const t = tokenize('Left$(s$, 3)', vocab)
    expect(types(t)).toEqual([
      TokenType.Function, // Left$  (one token)
      TokenType.LParen,
      TokenType.Identifier, // s
      TokenType.TypeSuffix, // $  (s$ is a variable, not a known word)
      TokenType.Comma,
      TokenType.NumberDec, // 3
      TokenType.RParen
    ])
    expect(t[0].value).toBe('Left$')
  })
})

describe('lexer: the vertical-slice target', () => {
  // The draw-text command is named DrawText (NOT Text): "Text" collided
  // case-insensitively with the graphics-mode constant TEXT, which a context-free
  // lexer cannot tell apart. DrawText removes the collision entirely, so it always
  // lexes unambiguously as a Command — no parser heuristic needed.
  it('tokenizes  DrawText 5, 5, "HELLO BREADCRAFT"  with correct positions', () => {
    const t = tokenize('DrawText 5, 5, "HELLO BREADCRAFT"', vocab)
    expect(types(t)).toEqual([
      TokenType.Command, // DrawText — unambiguous
      TokenType.NumberDec, // 5
      TokenType.Comma,
      TokenType.NumberDec, // 5
      TokenType.Comma,
      TokenType.String // "HELLO BREADCRAFT"
    ])
    expect(t[0]).toMatchObject({ line: 1, col: 1, value: 'DrawText' })
    const str = t.find((x) => x.type === TokenType.String)!
    expect(str.value).toBe('HELLO BREADCRAFT')
    expect(str.col).toBe(16)
  })

  it('keeps Graphics TEXT working — TEXT is still the mode constant', () => {
    const t = tokenize('Graphics TEXT', vocab)
    expect(types(t)).toEqual([TokenType.Command, TokenType.Constant])
  })

  it('tracks line numbers across newlines', () => {
    const t = tokenize('Graphics TEXT\nDrawText 0, 0, "HI"', vocab)
    const onLine2 = t.find((x) => x.line === 2 && x.value === 'DrawText')
    expect(onLine2).toMatchObject({ type: TokenType.Command, col: 1 })
  })
})

describe('lexer: statement separator (:)', () => {
  it('emits a StatementSep token for a colon', () => {
    const t = tokenize('a : b', vocab)
    expect(types(t)).toEqual([
      TokenType.Identifier,
      TokenType.StatementSep,
      TokenType.Identifier
    ])
  })

  it('handles a mid-line command after a colon (the If … : … : EndIf case)', () => {
    // DrawText is NOT at the line start here, but it is at a STATEMENT start
    // (after ':'). Because DrawText is collision-free, it lexes as a Command
    // regardless of position — this is exactly the case the rename fixes.
    const t = tokenize('If x > 10 : DrawText 2, 2, "Hallo!" : EndIf', vocab)
    expect(types(t)).toEqual([
      TokenType.Keyword, // If
      TokenType.Identifier, // x
      TokenType.Operator, // >
      TokenType.NumberDec, // 10
      TokenType.StatementSep, // :
      TokenType.Command, // DrawText (mid-line, still unambiguous)
      TokenType.NumberDec, // 2
      TokenType.Comma,
      TokenType.NumberDec, // 2
      TokenType.Comma,
      TokenType.String, // "Hallo!"
      TokenType.StatementSep, // :
      TokenType.Keyword // EndIf
    ])
  })
})

describe('lexer: operators and punctuation', () => {
  it('groups operator runs and emits parens/brackets/comma singly', () => {
    const t = tokenize('(a >= b)', vocab)
    expect(types(t)).toEqual([
      TokenType.LParen,
      TokenType.Identifier,
      TokenType.Operator,
      TokenType.Identifier,
      TokenType.RParen
    ])
    expect(t[2].value).toBe('>=')
  })
})

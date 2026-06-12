import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { tokenize, TokenType, type Token } from './index'

// Tests run against the REAL SSOT vocabulary so they verify the lexer against the
// actual BreadCraft language, not a hand-rolled mock.
//
// EISEN M2.T1: the lexer no longer assigns a grammar class. Every identifier-shaped
// lexeme is a single `Word`; whether it is a keyword/command/function/constant is
// decided later by the parser (`eff`/classify). These tests therefore assert Word
// everywhere a word appears — the old per-word Keyword/Command/Constant assertions
// moved to the parser's responsibility (covered by parser.test.ts / archcases).
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
    expect(t[0].type).toBe(TokenType.Word)
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

describe('lexer: words (no grammar class — that is the parser job now, M2.T1)', () => {
  it('emits every identifier-shaped lexeme as a Word, known or not', () => {
    // `Graphics` (a command) and `wibbleflop` (unknown) are BOTH just Words now —
    // the lexer carries no SSOT class. `Graphics TEXT` is two plain Words.
    expect(types(tokenize('Graphics TEXT', vocab))).toEqual([TokenType.Word, TokenType.Word])
    expect(tokenize('wibbleflop', vocab)[0].type).toBe(TokenType.Word)
    expect(tokenize('TEXT', vocab)[0].type).toBe(TokenType.Word)
  })

  it('preserves the source spelling on the Word value (case kept verbatim)', () => {
    // The lexer never canonicalizes case (the case-sensitivity flip is M2.T2); it
    // just records what was typed. `graphics` and `Graphics` are both Words with
    // their original spelling.
    expect(tokenize('graphics', vocab)[0]).toMatchObject({ type: TokenType.Word, value: 'graphics' })
    expect(tokenize('Graphics', vocab)[0]).toMatchObject({ type: TokenType.Word, value: 'Graphics' })
  })
})

describe('lexer: type suffixes (.b / .w / .i / $) on variables', () => {
  it('splits a $ suffix off an unknown identifier (string variable)', () => {
    const t = tokenize('name$', vocab)
    expect(types(t)).toEqual([TokenType.Word, TokenType.TypeSuffix])
    expect(t[0].value).toBe('name')
    expect(t[1].value).toBe('$')
  })

  it('splits .b and .w suffixes off an identifier', () => {
    expect(types(tokenize('score.b', vocab))).toEqual([TokenType.Word, TokenType.TypeSuffix])
    expect(types(tokenize('big.w', vocab))).toEqual([TokenType.Word, TokenType.TypeSuffix])
  })

  it('does not mistake .bonus for the .b suffix (more ident chars follow)', () => {
    // `.b` is only the byte suffix when nothing identifier-like follows the b — so
    // `.bonus` is NOT `.b` + `onus`. It reads as a (record-type) suffix `.bonus`
    // instead; the parser/symbol-table decides later that no such record exists.
    const t = tokenize('feld.bonus', vocab)
    expect(types(t)).toEqual([TokenType.Word, TokenType.TypeSuffix])
    expect(t[1].value).toBe('.bonus')
  })

  it('splits the signed .i suffix off an identifier', () => {
    const t = tokenize('vy.i', vocab)
    expect(types(t)).toEqual([TokenType.Word, TokenType.TypeSuffix])
    expect(t[1].value).toBe('.i')
  })

  it('does not mistake .item for the .i suffix (more ident chars follow)', () => {
    // `.i` is only the signed suffix when nothing identifier-like follows — `.item`
    // is NOT `.i` + `tem`. It reads as a record-type suffix `.item`.
    const t = tokenize('p.item', vocab)
    expect(types(t)).toEqual([TokenType.Word, TokenType.TypeSuffix])
    expect(t[1].value).toBe('.item')
  })
})

describe('lexer: records (Type/Field/EndType, backslash field access)', () => {
  it('lexes a record type suffix .Slot blindly (no record pre-scan, N2)', () => {
    // The lexer no longer knows which records exist — ANY `.Name` is a type suffix;
    // the parser attaches it and validates the type. `Dim t.Slot[5]` → t + `.Slot`.
    const t = tokenize('Dim t.Slot[5]', vocab)
    const sfx = t.find((x) => x.type === TokenType.TypeSuffix && x.value === '.Slot')
    expect(sfx).toBeDefined()
  })

  it('emits .Unknown as a suffix too — the lexer no longer gate-keeps record names', () => {
    // Pre-EISEN this stayed unattached (record-blind pre-scan); now the validity of
    // the record type is the parser/symbol-table's call, not the lexer's.
    const t = tokenize('Dim t.Unknown[5]', vocab)
    expect(t.some((x) => x.type === TokenType.TypeSuffix && x.value === '.Unknown')).toBe(true)
  })

  it('lexes the backslash field access as a Backslash token', () => {
    const src = ['Type Slot', '  Field count.b', 'EndType', 'x.b = t[3]\\count'].join('\n')
    const t = tokenize(src, vocab)
    expect(t.some((x) => x.type === TokenType.Backslash)).toBe(true)
  })
})

describe('lexer: $ as part of a canonical function name (boundary fix)', () => {
  // Left/Right collided case-insensitively with the JoyDir constants LEFT/RIGHT.
  // The fix: the string functions carry the BASIC $ suffix (Left$, Right$, …). The
  // ONE thing the lexer still needs the vocabulary for is this boundary — keep
  // `Left$` as a single Word (the parser classifies it as a Function) while `name$`
  // splits into `name` + a `$` type suffix.
  it('keeps Left$ / Right$ / Mid$ / Chr$ / Str$ as a single Word token', () => {
    for (const fn of ['Left$', 'Right$', 'Mid$', 'Chr$', 'Str$']) {
      const t = tokenize(fn, vocab)
      expect(t[0].type, fn).toBe(TokenType.Word)
      expect(t[0].value, fn).toBe(fn)
      expect(t[1].type, fn).toBe(TokenType.EOF) // exactly one token, no split
    }
  })

  it('still lexes bare LEFT / RIGHT as plain Words (no $ to keep)', () => {
    expect(types(tokenize('LEFT', vocab))).toEqual([TokenType.Word])
    expect(types(tokenize('RIGHT', vocab))).toEqual([TokenType.Word])
  })

  it('handles Left$ in a realistic call: Left$(s$, 3)', () => {
    const t = tokenize('Left$(s$, 3)', vocab)
    expect(types(t)).toEqual([
      TokenType.Word, // Left$  (one token)
      TokenType.LParen,
      TokenType.Word, // s
      TokenType.TypeSuffix, // $  (s$ is a variable, not a known word)
      TokenType.Comma,
      TokenType.NumberDec, // 3
      TokenType.RParen
    ])
    expect(t[0].value).toBe('Left$')
  })
})

describe('lexer: normalizer (two-word block endings, M2.T1)', () => {
  /** Values of the non-trivia tokens, for compact stream assertions. */
  function values(src: string): string[] {
    return tokenize(src, vocab)
      .filter((t) => t.type !== TokenType.EOF && t.type !== TokenType.Newline)
      .map((t) => t.value)
  }

  it('fuses every SSOT two-word ending into one keyword', () => {
    expect(values('End If')).toEqual(['EndIf'])
    expect(values('End Function')).toEqual(['EndFunction'])
    expect(values('Else If')).toEqual(['ElseIf'])
    expect(values('End Type')).toEqual(['EndType'])
    expect(values('End Select')).toEqual(['EndSelect'])
    expect(values('End Asm')).toEqual(['EndAsm'])
  })

  it('keeps Else and End untouched when not in a canonical pair', () => {
    // `Else` then a NEWLINE before `If` is an Else-block whose first statement is an
    // If — the Newline keeps them apart, so they must NOT fuse.
    expect(values('Else\nIf')).toEqual(['Else', 'If'])
    // `End` alone (the End command) stays one token.
    expect(values('End')).toEqual(['End'])
  })

  it('does not fuse the lowercase spelling (strict canonical, N10)', () => {
    // Lowercase `end if` is NOT canonical — it stays two words so the parser can
    // later answer "meintest Du `End If`?".
    expect(values('end if')).toEqual(['end', 'if'])
  })

  it('reports the fused token at the start position spanning both words', () => {
    const tok = tokenize('End If', vocab).find((t) => t.value === 'EndIf')!
    expect(tok).toMatchObject({ line: 1, col: 1, length: 6 })
  })
})

describe('lexer: the vertical-slice target', () => {
  // The draw-text command is named DrawText (NOT Text): "Text" collided with the
  // graphics-mode constant TEXT. Both are plain Words to the lexer now; the rename
  // still matters for the parser/SSOT, but at lex time there is no ambiguity to
  // resolve — every word is a Word.
  it('tokenizes  DrawText 5, 5, "HELLO BREADCRAFT"  with correct positions', () => {
    const t = tokenize('DrawText 5, 5, "HELLO BREADCRAFT"', vocab)
    expect(types(t)).toEqual([
      TokenType.Word, // DrawText
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

  it('tracks line numbers across newlines', () => {
    const t = tokenize('Graphics TEXT\nDrawText 0, 0, "HI"', vocab)
    const onLine2 = t.find((x) => x.line === 2 && x.value === 'DrawText')
    expect(onLine2).toMatchObject({ type: TokenType.Word, col: 1 })
  })
})

describe('lexer: statement separator (:)', () => {
  it('emits a StatementSep token for a colon', () => {
    const t = tokenize('a : b', vocab)
    expect(types(t)).toEqual([TokenType.Word, TokenType.StatementSep, TokenType.Word])
  })

  it('handles a mid-line command after a colon (the If … : … : EndIf case)', () => {
    // Position no longer changes a word's class (there is none); a mid-line word is
    // just a Word like any other. The parser sees it at a statement start (after ':').
    const t = tokenize('If x > 10 : DrawText 2, 2, "Hallo!" : EndIf', vocab)
    expect(types(t)).toEqual([
      TokenType.Word, // If
      TokenType.Word, // x
      TokenType.Operator, // >
      TokenType.NumberDec, // 10
      TokenType.StatementSep, // :
      TokenType.Word, // DrawText
      TokenType.NumberDec, // 2
      TokenType.Comma,
      TokenType.NumberDec, // 2
      TokenType.Comma,
      TokenType.String, // "Hallo!"
      TokenType.StatementSep, // :
      TokenType.Word // EndIf
    ])
  })
})

describe('lexer: operators and punctuation', () => {
  it('groups operator runs and emits parens/brackets/comma singly', () => {
    const t = tokenize('(a >= b)', vocab)
    expect(types(t)).toEqual([
      TokenType.LParen,
      TokenType.Word,
      TokenType.Operator,
      TokenType.Word,
      TokenType.RParen
    ])
    expect(t[2].value).toBe('>=')
  })
})

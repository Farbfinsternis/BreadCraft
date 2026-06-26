import { describe, it, expect } from 'vitest'
import { scanOutline } from './outline'

// The Outliner's line-based scanner. EISEN M2.T2: it now matches the case-sensitive
// language — only the canonical `Function` keyword starts a definition — and reads
// ';' comments (Sprachdef §B), not the old BASIC apostrophe.

describe('outline: function/statement detection', () => {
  it('reads the return-type suffix to tell a function from a statement', () => {
    const src = ['Function Distance.w(a.b, b.b)', 'Function Heal(n.b)', 'Function Label$()'].join('\n')
    expect(scanOutline(src)).toEqual([
      { name: 'Distance', kind: 'function', line: 1 },
      { name: 'Heal', kind: 'statement', line: 2 },
      { name: 'Label', kind: 'function', line: 3 }
    ])
  })

  it('recognises the signed .i return suffix as a function', () => {
    expect(scanOutline('Function Delta.i(a.i)')).toEqual([
      { name: 'Delta', kind: 'function', line: 1 }
    ])
  })

  it('is case-sensitive: lowercase `function` does NOT start a definition (M2.T2)', () => {
    expect(scanOutline('function foo()')).toEqual([])
    expect(scanOutline('FUNCTION Bar()')).toEqual([])
  })

  it("ignores a ';' comment, not the old apostrophe (Befund 2)", () => {
    // A ';'-commented-out def is invisible; an apostrophe is now ordinary text, so a
    // real def with a trailing ';' note is still found.
    const src = ['; Function Hidden()', 'Function Real() ; the live one'].join('\n')
    expect(scanOutline(src)).toEqual([{ name: 'Real', kind: 'statement', line: 2 }])
  })

  it('does not treat a quoted ; as a comment', () => {
    expect(scanOutline('Function Talk()')).toEqual([{ name: 'Talk', kind: 'statement', line: 1 }])
  })
})

describe('outline: "; #" section waypoints', () => {
  it('reads a "; #" comment as a section, interleaved in source order', () => {
    const src = ['; # Konstanten', 'Function Reset()', '; # Hauptschleife', 'Function Loop()'].join(
      '\n'
    )
    expect(scanOutline(src)).toEqual([
      { name: 'Konstanten', kind: 'section', line: 1 },
      { name: 'Reset', kind: 'statement', line: 2 },
      { name: 'Hauptschleife', kind: 'section', line: 3 },
      { name: 'Loop', kind: 'statement', line: 4 }
    ])
  })

  it('tolerates extra #, leading indent, and trims the title', () => {
    expect(scanOutline('   ;  ##   Spieler-Logik  ')).toEqual([
      { name: 'Spieler-Logik', kind: 'section', line: 1 }
    ])
  })

  it('a plain ; comment without # is not a section', () => {
    expect(scanOutline('; just a note')).toEqual([])
  })

  it('an empty "; #" marker (no title) is ignored', () => {
    expect(scanOutline('; #')).toEqual([])
  })
})

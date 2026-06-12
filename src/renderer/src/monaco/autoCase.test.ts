import { describe, it, expect } from 'vitest'
import { shouldCanonicalize } from './autoCase'
import type { VocabItem } from '@renderer/language/ssot'

// EISEN M2.T2b / N4 — auto-casing must protect the user's own variables under
// case-sensitivity. `decide` mirrors how the editor calls shouldCanonicalize: it
// locates the word in the line and asks whether it may be canonicalized.

function decide(line: string, word: string, kind: VocabItem['kind']): boolean {
  const start = line.indexOf(word)
  if (start < 0) throw new Error(`"${word}" not in ${JSON.stringify(line)}`)
  return shouldCanonicalize(line, start, start + word.length, kind)
}

describe('autoCase: protects variables (the N4 cases)', () => {
  it('vwait = 1 in an empty file → vwait is NOT canonicalized', () => {
    // At space-time the line is just "vwait " — the word is at statement start and
    // completed by whitespace, the exact ambiguity N4 calls out. Leave it.
    expect(decide('vwait ', 'vwait', 'command')).toBe(false)
    // and once the '=' is typed, the target rule keeps protecting it.
    expect(decide('vwait =', 'vwait', 'command')).toBe(false)
    expect(decide('vwait = 1', 'vwait', 'command')).toBe(false)
  })

  it('a declared variable named like a keyword is left alone in value position', () => {
    // `x = next + 1` — `next` folds to the Next keyword, but keywords are not values,
    // so a value-position fold is a variable. Don't touch it.
    expect(decide('x = next ', 'next', 'keyword')).toBe(false)
    // same for a function-fold used WITHOUT parens (`max` ≠ a Max() call).
    expect(decide('x = max ', 'max', 'function')).toBe(false)
  })

  it('the name being declared is never canonicalized', () => {
    expect(decide('Dim fire.b[10]', 'fire', 'constant')).toBe(false)
    expect(decide('Global next.b = 0', 'next', 'keyword')).toBe(false)
    expect(decide('Const max = 5', 'max', 'function')).toBe(false)
    expect(decide('For next = 0 To 9', 'next', 'keyword')).toBe(false)
  })

  it('a parameter name in a Function definition is left alone', () => {
    expect(decide('Function Foo(fire.b, n.b)', 'fire', 'constant')).toBe(false)
  })

  it('an index / field target is left alone', () => {
    expect(decide('feld[i]', 'feld', 'command')).toBe(false)
    expect(decide('p\\count = 5', 'p', 'command')).toBe(false)
  })
})

describe('autoCase: still canonicalizes where a CRUMB word is unambiguous', () => {
  it('a constant in argument position → cased (Cls black → BLACK)', () => {
    expect(decide('Cls black', 'black', 'constant')).toBe(true)
    expect(decide('Graphics text', 'text', 'constant')).toBe(true)
  })

  it('a called function → cased (joystick(LEFT) → Joystick, max(3) → Max)', () => {
    expect(decide('joystick(LEFT)', 'joystick', 'function')).toBe(true)
    expect(decide('x = max(3)', 'max', 'function')).toBe(true)
  })

  it('a command typed as a call at statement start → callee cased', () => {
    expect(decide('joystick(LEFT)', 'joystick', 'function')).toBe(true)
  })
})

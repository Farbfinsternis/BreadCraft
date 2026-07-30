import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile } from './index'
import type { SourceReader } from './resolve-includes'

// B3.T3 — Include wired into the front door. The load-bearing proof: a program split
// across files, resolved by compile(readSource), generates byte-identical C to the same
// program written as one file. Everything else (stage tag, provenance, the single-file
// fallback error) rides on that seam.

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

const reader = (files: Record<string, string>): SourceReader => (p) =>
  Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null

describe('B3.T3: Include in the front door', () => {
  it('a split program builds byte-identical C to the concatenated single file', () => {
    // `Add.b` — a function that hands a value back needs the suffix that says so
    // ([[breadcraft-functions-vs-statements]]). Written without it until T5, when the
    // codegen learnt to notice: the suffix-less form was emitting `void Add(…) { return
    // a + b; }`, which cc65 rejects outright. The test never got as far as cc65.
    const logic = ['Function Add.b(a.b, b.b)', '  Return a + b', 'EndFunction'].join('\n')
    const entry = ['Global score = 0', 'Include "logic"', 'score = Add(2, 3)'].join('\n')
    const single = ['Global score = 0', logic, 'score = Add(2, 3)'].join('\n')

    const split = compile(entry, vocab, undefined, 'de', undefined, 'main.crumb', reader({ 'logic.crumb': logic }))
    const flat = compile(single, vocab)

    expect(split.errors).toEqual([])
    expect(flat.errors).toEqual([])
    expect(split.code).toBe(flat.code)
  })

  it('resolves a nested chain and still matches the flattened source', () => {
    const files = {
      'a.crumb': ['Global g = 1', 'Include "b"'].join('\n'),
      'b.crumb': 'g = g + 1'
    }
    const entry = 'Include "a"'
    const single = ['Global g = 1', 'g = g + 1'].join('\n')

    const split = compile(entry, vocab, undefined, 'de', undefined, 'main.crumb', reader(files))
    const flat = compile(single, vocab)
    expect(split.errors).toEqual([])
    expect(split.code).toBe(flat.code)
  })

  it('an include-stage error surfaces with stage "include" and the entry file', () => {
    const r = compile('Include "missing"', vocab, undefined, 'de', undefined, 'main.crumb', reader({}))
    const inc = r.errors.find((e) => e.stage === 'include')
    expect(inc).toBeDefined()
    expect(inc!.message).toContain('missing.crumb')
    expect(inc!.file).toBe('main.crumb')
  })

  it('a parse error inside an included file names THAT file', () => {
    // `Next = 1` — a reserved word as a target — is a parse error, raised in b.crumb.
    const files = { 'b.crumb': 'Next = 1' }
    const r = compile('Include "b"', vocab, undefined, 'de', undefined, 'main.crumb', reader(files))
    const pe = r.errors.find((e) => e.stage === 'parse')
    expect(pe).toBeDefined()
    expect(pe!.file).toBe('b.crumb')
  })

  it('without a reader, a stray Include is an honest parse error (not "unsupported")', () => {
    const r = compile('Include "x"\nDrawText 1, 1, "hi"', vocab)
    const pe = r.errors.find((e) => e.stage === 'parse')
    expect(pe).toBeDefined()
    expect(pe!.message).toMatch(/Projekt-Build/)
    // recovery: the DrawText after it still compiles into the C
    expect(r.code).toMatch(/hi/)
  })

  it('no reader + no Include is unchanged (byte-identical single-file path)', () => {
    const src = 'Global g = 0\ng = g + 1'
    const withName = compile(src, vocab, undefined, 'de', undefined, 'main.crumb')
    const plain = compile(src, vocab)
    expect(withName.code).toBe(plain.code)
  })
})

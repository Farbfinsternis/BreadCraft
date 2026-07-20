import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { tokenize } from './lexer'
import { compile } from './index'

// B3.T1 — source-file provenance through the whole chain. A token carries the file it
// was scanned from; a diagnostic carries the file it lives in. This is the groundwork
// that lets `Include` (B3.T3) report an error in crumbs/physics.crumb AS physics.crumb,
// not as main.crumb (memory: breadcraft-ux-railing). With ONE file (today) the only
// change is: errors gain a `file` — the generated C is byte-identical (proven on ITD).

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

describe('B3.T1: source-file provenance', () => {
  it('tokenize stamps the file name onto every token when given one', () => {
    const toks = tokenize('DrawText 1, 1, "hi"', vocab, 'de', 'main.crumb')
    expect(toks.length).toBeGreaterThan(1)
    expect(toks.every((t) => t.file === 'main.crumb')).toBe(true)
  })

  it('a fused two-word keyword (EndIf) keeps its file', () => {
    // `End If` merges into one Keyword token in normalize(); provenance must survive it.
    const src = ['If x > 0', '  x = 1', 'End If'].join('\n')
    const toks = tokenize(src, vocab, 'de', 'logic.crumb')
    const endif = toks.find((t) => t.value === 'EndIf')
    expect(endif?.file).toBe('logic.crumb')
  })

  it('without a file name, tokens carry no file (byte-identity guard)', () => {
    const toks = tokenize('DrawText 1, 1, "hi"', vocab)
    expect(toks.every((t) => t.file === undefined)).toBe(true)
  })

  it('a parse error names its file when compiled with an entry name', () => {
    const { errors } = compile('Next = 1', vocab, undefined, 'de', undefined, 'main.crumb')
    const parseErr = errors.find((e) => e.stage === 'parse')
    expect(parseErr).toBeDefined()
    expect(parseErr!.file).toBe('main.crumb')
  })

  it('a codegen error names its file when compiled with an entry name', () => {
    // DrawMap with no prior UseTileset is an honest codegen-stage error.
    const { errors } = compile('DrawMap "level1"', vocab, undefined, 'de', undefined, 'enemies.crumb')
    const codegenErr = errors.find((e) => e.stage === 'codegen' && e.severity === 'error')
    expect(codegenErr).toBeDefined()
    expect(codegenErr!.file).toBe('enemies.crumb')
  })

  it('without an entry name, errors carry no file (single-file compile unchanged)', () => {
    const { errors } = compile('Next = 1', vocab)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((e) => e.file === undefined)).toBe(true)
  })
})

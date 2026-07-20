import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { TokenType, type Token } from './lexer/token'
import { parse } from './parser'
import { resolveIncludes, type SourceReader } from './resolve-includes'

// B3.T2 — the Include resolver, tested with a fake filesystem (a path→source map), no
// real disk. Covers the plan's required cases (simple, nested, once, cycle, missing,
// include-in-function) plus the closed design decisions (nested folders, `..`/absolute
// rejection, no false positive after a loop) and provenance through the splice.

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

const reader = (files: Record<string, string>): SourceReader => (p) =>
  Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null

function resolve(entry: string, files: Record<string, string>, entryName = 'main.crumb'): ReturnType<typeof resolveIncludes> {
  return resolveIncludes(entry, entryName, reader(files), vocab)
}

/** The Word/String lexemes of a token stream, for order/content assertions. */
function words(tokens: Token[]): string[] {
  return tokens
    .filter((t) => t.type === TokenType.Word || t.type === TokenType.String)
    .map((t) => t.value)
}

describe('B3.T2: Include resolver', () => {
  it('splices a single included file in place (Include + name are consumed)', () => {
    const r = resolve('a = 1\nInclude "physics"\nb = 2', { 'physics.crumb': 'phys = 9' })
    expect(r.errors).toEqual([])
    const w = words(r.tokens)
    expect(w).toContain('phys') // the included content is present
    expect(w).not.toContain('Include') // the directive itself is gone
    expect(w).not.toContain('physics') // ...and so is its path string
    // order: entry-before, then spliced, then entry-after
    expect(w.indexOf('a')).toBeLessThan(w.indexOf('phys'))
    expect(w.indexOf('phys')).toBeLessThan(w.indexOf('b'))
  })

  it('resolves nested includes depth-first', () => {
    const r = resolve('Include "a"', {
      'a.crumb': 'aa = 1\nInclude "b"',
      'b.crumb': 'bb = 2'
    })
    expect(r.errors).toEqual([])
    const w = words(r.tokens)
    expect(w).toEqual(['aa', 'bb'])
  })

  it('include-once: a file reached twice is spliced only once', () => {
    const r = resolve('Include "a"\nInclude "b"', {
      'a.crumb': 'Include "shared"',
      'b.crumb': 'Include "shared"',
      'shared.crumb': 'sharedmarker = 1'
    })
    expect(r.errors).toEqual([])
    const count = words(r.tokens).filter((x) => x === 'sharedmarker').length
    expect(count).toBe(1)
  })

  it('a cycle is an honest error naming the chain', () => {
    const r = resolve('Include "a"', {
      'a.crumb': 'Include "b"',
      'b.crumb': 'Include "a"'
    })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/Zyklus/)
    expect(r.errors[0].message).toContain('a.crumb → b.crumb → a.crumb')
  })

  it('a missing file names the path and the including location', () => {
    const r = resolve('x = 1\nInclude "nope"', {})
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toContain('nope.crumb')
    expect(r.errors[0].message).toContain('main.crumb:2') // included from main.crumb line 2
  })

  it('Include inside a function is rejected (top-level only)', () => {
    const r = resolve('Function Foo()\n  Include "x"\nEndFunction', { 'x.crumb': 'q = 1' })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/obersten Ebene|Funktion/)
    expect(words(r.tokens)).not.toContain('q') // not spliced
  })

  it('a top-level Include after a For…Next loop is fine (no false positive)', () => {
    const r = resolve('For i = 0 To 3\n  x = i\nNext\nInclude "after"', { 'after.crumb': 'done = 1' })
    expect(r.errors).toEqual([])
    expect(words(r.tokens)).toContain('done')
  })

  it('allows nested subfolders in the path', () => {
    const r = resolve('Include "engine/enemies"', { 'engine/enemies.crumb': 'boss = 1' })
    expect(r.errors).toEqual([])
    expect(words(r.tokens)).toContain('boss')
  })

  it('rejects a `..` escape', () => {
    const r = resolve('Include "../secret"', { '../secret.crumb': 'leak = 1' })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/\.\.|verlassen/)
  })

  it('rejects an absolute path', () => {
    const r = resolve('Include "/etc/passwd"', {})
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/relativ|absolut|Wurzel/)
  })

  it('rejects junk after the file name', () => {
    const r = resolve('Include "a" foo', { 'a.crumb': 'z = 1' })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/nichts weiter/)
  })

  it('reports a missing quoted path', () => {
    const r = resolve('Include foo', { 'foo.crumb': 'z = 1' })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toMatch(/Anführungszeichen/)
  })

  it('carries provenance: spliced tokens name their own file', () => {
    const r = resolve('a = 1\nInclude "physics"', { 'physics.crumb': 'phys = 9' })
    const physTok = r.tokens.find((t) => t.value === 'phys')
    const aTok = r.tokens.find((t) => t.value === 'a')
    expect(physTok?.file).toBe('physics.crumb')
    expect(aTok?.file).toBe('main.crumb')
  })

  it('ends in exactly one EOF and no intermediate EOF', () => {
    const r = resolve('Include "a"', { 'a.crumb': 'aa = 1\nInclude "b"', 'b.crumb': 'bb = 2' })
    const eofs = r.tokens.filter((t) => t.type === TokenType.EOF)
    expect(eofs).toHaveLength(1)
    expect(r.tokens[r.tokens.length - 1].type).toBe(TokenType.EOF)
  })

  it('the merged stream parses cleanly (splice produces valid structure)', () => {
    const r = resolve('Global score = 0\nInclude "logic"', {
      'logic.crumb': 'Function Add(n.b)\n  score = score + n\nEndFunction'
    })
    expect(r.errors).toEqual([])
    const { errors } = parse(r.tokens, vocab)
    expect(errors).toEqual([])
  })

  it('English locale localizes include errors', () => {
    const r = resolveIncludes('Include "nope"', 'main.crumb', reader({}), vocab, 'en')
    expect(r.errors[0].message).toMatch(/not found/)
  })
})

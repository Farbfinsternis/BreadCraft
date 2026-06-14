import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile } from '../index'

// STAHL S5b (part 2): codegen diagnostics are localizable. Default (no locale) stays
// German byte-for-byte (existing codegen tests assert German); locale 'en' yields
// English. These pin both sides on a few representative codegen errors.

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

function errs(src: string, locale?: 'de' | 'en'): string {
  return compile(src, vocab, undefined, locale)
    .errors.filter((e) => e.severity === 'error')
    .map((e) => e.message)
    .join(' | ')
}

function warns(src: string, locale?: 'de' | 'en'): string {
  return compile(src, vocab, undefined, locale)
    .errors.filter((e) => e.severity === 'warn')
    .map((e) => e.message)
    .join(' | ')
}

describe('codegen diagnostics: localization (S5b part 2)', () => {
  it('recursion error: German by default, English on locale en', () => {
    const src = ['Function Foo()', '  Foo', 'EndFunction'].join('\n')
    expect(errs(src)).toMatch(/Rekursion ist nicht erlaubt/)
    const en = errs(src, 'en')
    expect(en).toMatch(/recursion is not allowed/)
    expect(en).toMatch(/rewrite it iteratively/)
    expect(en).not.toMatch(/Rekursion/)
  })

  it('unknown function call translates', () => {
    expect(errs('DoesNotExist')).toMatch(/Unbekannte Funktion/)
    expect(errs('DoesNotExist', 'en')).toMatch(/unknown function 'DoesNotExist'/)
  })

  it('a command-arity error (Sprite) translates', () => {
    expect(errs('Sprite 1')).toMatch(/Sprite erwartet/)
    expect(errs('Sprite 1', 'en')).toMatch(/Sprite expects n, x, y/)
  })

  it('default locale is byte-identical to explicit German', () => {
    const src = ['Function Foo()', '  Foo', 'EndFunction'].join('\n')
    expect(errs(src)).toBe(errs(src, 'de'))
  })

  it('a narrowing warning translates BOTH its template and its reason', () => {
    const src = 'gross.w = 1000\nklein.b = gross'
    // German: template ("Verkleinerung") + reason ("passt nicht in ein Byte").
    expect(warns(src)).toMatch(/Verkleinerung beim Schreiben/)
    expect(warns(src)).toMatch(/passt nicht in ein Byte/)
    // English: both halves English, no German leaking through (the reason was the gap).
    const en = warns(src, 'en')
    expect(en).toMatch(/narrowing when writing/)
    expect(en).toMatch(/doesn't fit in a byte/)
    expect(en).not.toMatch(/Verkleinerung|Byte \(\.b, 0–255\) — höhere/)
  })
})

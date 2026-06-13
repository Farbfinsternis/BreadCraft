import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { tokenize } from '../lexer'
import { parse } from './index'

// STAHL S5b: parser diagnostics are localizable. The default (no locale) stays
// German byte-for-byte (so every existing test keeps matching); locale 'en' yields
// the English text the IDE needs when its language is English. These pin both sides.

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

function errs(src: string, locale?: 'de' | 'en'): string {
  return parse(tokenize(src, vocab), vocab, locale)
    .errors.map((e) => e.message)
    .join(' | ')
}

describe('parser diagnostics: localization (S5b)', () => {
  it('reserved word as a name: German by default, English on locale en', () => {
    const de = errs('Next = 1')
    expect(de).toMatch(/CRUMB-Wort/)
    expect(de).toMatch(/Next/)

    const en = errs('Next = 1', 'en')
    expect(en).toMatch(/is a CRUMB word/)
    expect(en).toMatch(/lower case/)
    expect(en).not.toMatch(/CRUMB-Wort/) // no German leaked through
  })

  it('miscased keyword hint translates, keeping the case-sensitivity note', () => {
    const src = ['if x > 0', '  x = 2', 'EndIf'].join('\n')
    expect(errs(src)).toMatch(/meintest Du.*If/i)
    const en = errs(src, 'en')
    expect(en).toMatch(/did you mean.*If/i)
    expect(en).toMatch(/case-sensitive/i)
  })

  it('a missing declaration name uses the localized role noun', () => {
    expect(errs('Function')).toMatch(/Funktionsname erwartet/)
    expect(errs('Function', 'en')).toMatch(/function name expected/)
  })

  it('default locale is byte-identical to explicit German', () => {
    const src = 'Dim'
    expect(errs(src)).toBe(errs(src, 'de'))
  })
})

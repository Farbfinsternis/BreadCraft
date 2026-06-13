import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { tokenize, TokenType } from './index'

// STAHL S5b (part 3): lexer Error-token messages are localizable. Default (no locale)
// stays German byte-for-byte; locale 'en' yields English.

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

function errMsg(src: string, locale?: 'de' | 'en'): string | undefined {
  return tokenize(src, vocab, locale).find((t) => t.type === TokenType.Error)?.error
}

describe('lexer diagnostics: localization (S5b part 3)', () => {
  it('unexpected character: German by default, English on locale en', () => {
    expect(errMsg("'")).toMatch(/Unerwartetes Zeichen/)
    expect(errMsg("'", 'en')).toMatch(/unexpected character/)
  })

  it('unterminated string translates', () => {
    expect(errMsg('"oops')).toMatch(/Nicht geschlossener Text/)
    expect(errMsg('"oops', 'en')).toMatch(/unterminated string/)
  })
})

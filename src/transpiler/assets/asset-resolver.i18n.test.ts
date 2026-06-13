import { describe, it, expect } from 'vitest'
import { resolveCharset, type AssetManifest, type AssetReader } from './asset-resolver'

// STAHL S5b (part 3): asset-resolver diagnostics are localizable — including the
// structural predicates that come from the shared format codecs (which the resolver
// now drives with the same locale). Default stays German; locale 'en' yields English.

const CHAR_COUNT = 256

function petscii(edits: Record<number, number[]> = {}): string {
  const chars: number[][] = []
  for (let i = 0; i < CHAR_COUNT; i++) chars.push(edits[i] ?? new Array(8).fill(0))
  return JSON.stringify({ format: 'breadcraft.petscii', version: 1, charCount: CHAR_COUNT, chars })
}
const reader = (files: Record<string, string>): AssetReader => (rel) => (rel in files ? files[rel] : null)
const manifest = (charsets: string[]): AssetManifest => ({
  palette: null,
  charsets,
  tilemaps: [],
  sprites: []
})

describe('asset-resolver diagnostics: localization (S5b part 3)', () => {
  it('unknown id: German by default, English on locale en', () => {
    const files = reader({ 'main.petscii': petscii() })
    expect(() => resolveCharset('ghost', manifest(['main.petscii']), files)).toThrowError(
      /unbekanntes Tileset 'ghost'/
    )
    expect(() => resolveCharset('ghost', manifest(['main.petscii']), files, 'en')).toThrowError(
      /unknown tileset 'ghost'/
    )
  })

  it('structural error (broken JSON) translates via the shared codec', () => {
    const files = reader({ 'main.petscii': '{ nope' })
    expect(() => resolveCharset('main', manifest(['main.petscii']), files)).toThrowError(
      /ist kein gültiges \.petscii/
    )
    expect(() => resolveCharset('main', manifest(['main.petscii']), files, 'en')).toThrowError(
      /tileset 'main.petscii' is not a valid \.petscii/
    )
  })

  it('element-validation error (bad byte) translates', () => {
    const chars: number[][] = new Array(CHAR_COUNT).fill(0).map(() => [0, 0, 0, 0, 0, 0, 0, 0])
    chars[3] = [0, 0, 0, 999, 0, 0, 0, 0]
    const files = reader({ 'main.petscii': JSON.stringify({ chars }) })
    expect(() => resolveCharset('main', manifest(['main.petscii']), files)).toThrowError(
      /Zeichen 3, Byte 3/
    )
    expect(() => resolveCharset('main', manifest(['main.petscii']), files, 'en')).toThrowError(
      /char 3, byte 3/
    )
  })
})

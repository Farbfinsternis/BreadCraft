import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { DEFAULT_GRAPHICS_MODE } from '@shared/ipc'
import { tokenize } from '../transpiler/lexer'
import { TokenType } from '../transpiler/lexer/token'
import { createFile, sampleMain } from './project'

// M1.T3 (Befund 2, Teil 1): freshly-generated .crumb content must lex CLEAN. The bug
// was a BASIC-style `'` comment header on every new file — CRUMB comments use `;`, so
// the first line was a lexer Error token. This guards both content generators.

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)
function errorTokens(src: string): string[] {
  return tokenize(src, vocab)
    .filter((t) => t.type === TokenType.Error)
    .map((t) => `${t.line}:${t.col} ${t.value}`)
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bc-fresh-'))
  // createFile needs an existing .bread to register the new crumb into.
  writeFileSync(join(dir, `${basename(dir)}.bread`), JSON.stringify({ name: 't', crumbs: [], assets: {} }))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('fresh .crumb content lexes clean (M1.T3, Befund 2)', () => {
  it('createFile writes a `;` header, not a BASIC `\'` — no Error tokens', () => {
    const file = createFile(dir, 'enemies')
    expect(file.content.startsWith('; ')).toBe(true)
    expect(errorTokens(file.content)).toEqual([])
    // and the same on disk
    const onDisk = readFileSync(join(dir, file.rel), 'utf-8')
    expect(errorTokens(onDisk)).toEqual([])
  })

  it('sampleMain boilerplate lexes clean', () => {
    expect(errorTokens(sampleMain(DEFAULT_GRAPHICS_MODE))).toEqual([])
  })
})

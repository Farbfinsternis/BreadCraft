import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { projectRegion } from './project'

// STAHL S5c: the project's target region rides in the .bread and reads back normalized.
// Old files (no region) must read as PAL, never crash — and a bad value can't poison the
// build, it falls back to PAL.

let dir: string
function writeBread(extra: Record<string, unknown>): void {
  const bread = { name: 't', entry: 'main.crumb', crumbs: [], assets: {}, ...extra }
  writeFileSync(join(dir, `${basename(dir)}.bread`), JSON.stringify(bread))
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bc-region-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('project region persistence (STAHL S5c)', () => {
  it('reads a stored NTSC region', () => {
    writeBread({ region: 'NTSC' })
    expect(projectRegion(dir)).toBe('NTSC')
  })

  it('old files without a region read as PAL', () => {
    writeBread({})
    expect(projectRegion(dir)).toBe('PAL')
  })

  it('an invalid region normalizes to PAL (never poisons the build)', () => {
    writeBread({ region: 'SECAM' })
    expect(projectRegion(dir)).toBe('PAL')
  })
})

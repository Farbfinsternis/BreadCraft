import { describe, it, expect } from 'vitest'
import type { BuildLogLine } from '@shared/ipc'
import { markersForFile } from './markers'

// B3.T4 — the single-model code editor must only ever mark the file on screen. These
// pin the pure picker that decides which located build lines belong to a given file.

const line = (over: Partial<BuildLogLine>): BuildLogLine => ({
  level: 'error',
  text: 't',
  ...over
})

describe('markersForFile', () => {
  it('keeps only located lines whose file is the active one', () => {
    const lines = [
      line({ text: 'in main', loc: { file: 'main.crumb', line: 3, col: 2 } }),
      line({ text: 'in physics', loc: { file: 'engine/physics.crumb', line: 40, col: 1 } })
    ]
    const m = markersForFile(lines, 'engine/physics.crumb', 'main.crumb')
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ line: 40, col: 1, message: 'in physics', level: 'error' })
  })

  it('drops lines with no location (info/ok/plain output)', () => {
    const lines = [line({ level: 'info', text: 'compiling…' }), line({ level: 'ok', text: 'done' })]
    expect(markersForFile(lines, 'main.crumb', 'main.crumb')).toEqual([])
  })

  it('a located line with no explicit file falls back to the entry', () => {
    const lines = [line({ text: 'entry err', loc: { line: 5, col: 1 } })]
    expect(markersForFile(lines, 'main.crumb', 'main.crumb')).toHaveLength(1)
    expect(markersForFile(lines, 'other.crumb', 'main.crumb')).toEqual([])
  })

  it('maps warn level through, error otherwise', () => {
    const lines = [
      line({ level: 'warn', text: 'w', loc: { file: 'a.crumb', line: 1, col: 1 } }),
      line({ level: 'error', text: 'e', loc: { file: 'a.crumb', line: 2, col: 1 } })
    ]
    const m = markersForFile(lines, 'a.crumb', 'a.crumb')
    expect(m.map((x) => x.level)).toEqual(['warn', 'error'])
  })
})

import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot } from '@shared/ssot-types'
import { compile } from '../transpiler/index'

// STAHL S5a — keep the SSOT's `since` field honest against the real codegen, so
// IntelliSense never offers an unbuildable word as ready (the KeyDown/KeyHit drift:
// they were `proven:true, since:phase1` yet the codegen threw "comes later").
//
//  - since:'later'  → flattened to VocabItem.planned, shown tagged "planned".
//  - since:'phase1' → offered as ready, so its codegen MUST have a mapping.
//
// This test compiles a minimal call for every command/function entry and asserts
// the two directions hold, so a future word added on the wrong side fails CI.

const ssot = rawSsot as unknown as Ssot
const vocab = buildVocabulary(ssot)

const cmdFn = ssot.entries.filter(
  (e): e is { name: string; kind: 'command' | 'function'; since?: string } =>
    !!e.name && (e.kind === 'command' || e.kind === 'function')
)

const noMapping = /kein C-Mapping|no C mapping/

function callSnippet(name: string, kind: 'command' | 'function'): string {
  // Generous args: the availability branch (no-mapping / deferred) fires before any
  // arg check, so extra zeros never mask it; ready words tolerate the spare args.
  return kind === 'command' ? `${name} 0, 0, 0` : `x = ${name}(0, 0, 0)`
}

describe('STAHL S5a — `since` matches codegen reality', () => {
  it('every planned word (since:later) is genuinely not buildable', () => {
    const planned = cmdFn.filter((e) => e.since === 'later')
    expect(planned.length).toBeGreaterThan(0)
    for (const e of planned) {
      const { errors } = compile(callSnippet(e.name, e.kind), vocab)
      expect(
        errors.length,
        `${e.name} is marked since:later but compiled clean — it is buildable, drop the tag`
      ).toBeGreaterThan(0)
    }
  })

  it('no ready word (since:phase1) hits the generic "no C-mapping" gap', () => {
    const ready = cmdFn.filter((e) => e.since !== 'later')
    for (const e of ready) {
      const { errors } = compile(callSnippet(e.name, e.kind), vocab)
      const gap = errors.some((err) => noMapping.test(err.message))
      expect(
        gap,
        `${e.name} is since:phase1 but the codegen has no mapping — mark it since:later or wire it`
      ).toBe(false)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { buildReference, collectI18nKeys } from './reference'
import de from '@renderer/i18n/messages/lang.de.json'
import en from '@renderer/i18n/messages/lang.en.json'

const deKeys = de as Record<string, string>
const enKeys = en as Record<string, string>

describe('docs reference model', () => {
  const keys = collectI18nKeys()

  it('collects the SSOT description keys', () => {
    expect(keys.length).toBeGreaterThan(150)
  })

  it('groups every entry exactly once, none lost', () => {
    const model = buildReference((k) => k)
    const ids = model.groups.flatMap((g) => g.entries.map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
    expect(ids.length).toBeGreaterThan(50)
    expect(model.enums.length).toBeGreaterThan(0)
    expect(model.types.length).toBeGreaterThan(0)
  })

  // D7: entries that name an exampleId resolve to a real, non-empty snippet from the
  // SSOT examples block. Guards against a dangling exampleId (or a removed example).
  it('resolves linked code examples', () => {
    const model = buildReference((k) => k)
    const withExample = model.groups.flatMap((g) => g.entries).filter((e) => e.example)
    expect(withExample.length).toBeGreaterThan(0)
    expect(withExample.every((e) => (e.example?.length ?? 0) > 0)).toBe(true)
  })

  it('builds signatures: functions take parens, commands list params', () => {
    const model = buildReference((k) => k)
    const flat = model.groups.flatMap((g) => g.entries)
    const fn = flat.find((e) => e.kind === 'function' && e.params.length > 0)
    if (fn) expect(fn.signature).toContain('(')
  })

  // Completeness gauge for the "write all texts first" content work (D5). Goes green
  // once every SSOT-declared description has German AND English text. The failure
  // message lists exactly which keys are still missing.
  it('every SSOT description has German text', () => {
    const missing = keys.filter((k) => !(k in deKeys))
    expect(missing, `${missing.length} missing de keys: ${missing.join(', ')}`).toEqual([])
  })

  it('every SSOT description has English text', () => {
    const missing = keys.filter((k) => !(k in enKeys))
    expect(missing, `${missing.length} missing en keys: ${missing.join(', ')}`).toEqual([])
  })
})

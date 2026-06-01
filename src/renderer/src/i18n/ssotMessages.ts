import rawSsot from '@shared/breadcraft.lang.json'
import type { Ssot } from '@shared/ssot-types'

/**
 * Collect every i18nKey declared in the SSOT (breadcraft.lang.json). The SSOT
 * holds the *keys*; the human texts live in i18n/lang.<locale>.json. This walker
 * just enumerates which keys exist, so the i18n layer can warn about gaps and so
 * one merged vue-i18n message tree covers UI strings AND language vocabulary
 * (memory: breadcraft-localization, breadcraft-ssot-langjson).
 */
export function collectSsotI18nKeys(): string[] {
  const ssot = rawSsot as unknown as Ssot
  const keys = new Set<string>()
  const add = (k?: string): void => {
    if (k) keys.add(k)
  }

  for (const t of ssot.types ?? []) add((t as { i18nKey?: string }).i18nKey)

  for (const e of ssot.enums ?? []) {
    add(e.i18nKey)
    for (const v of e.values ?? []) add(v.i18nKey)
  }

  const walkEntries = (entries?: Array<Record<string, unknown>>): void => {
    for (const entry of entries ?? []) {
      add(entry.i18nKey as string | undefined)
      const ret = entry.returns as { i18nKey?: string } | null | undefined
      add(ret?.i18nKey)
      for (const p of (entry.params as Array<{ i18nKey?: string }>) ?? []) add(p.i18nKey)
    }
  }
  walkEntries(ssot.entries as Array<Record<string, unknown>>)
  walkEntries(ssot.operators as Array<Record<string, unknown>>)

  return [...keys]
}

/**
 * Build the `lang.*` sub-tree of vue-i18n messages for one locale: map each
 * SSOT i18nKey to its text from lang.<locale>.json. Missing texts are left out
 * (vue-i18n then falls back / surfaces the key), so an unfinished lang file is
 * harmless. Keys are stored flat (dots are literal, not nested paths).
 */
export function buildLangMessages(langTexts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const knownKeys = new Set(collectSsotI18nKeys())
  for (const [key, text] of Object.entries(langTexts)) {
    // Only forward keys the SSOT actually declares — guards against typos drifting
    // in lang.<locale>.json. Unknown keys are ignored (could warn in dev later).
    if (knownKeys.has(key)) out[key] = text
  }
  return out
}

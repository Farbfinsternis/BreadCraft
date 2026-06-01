import type { Ssot, VocabItem } from './ssot-types'

/**
 * Flatten the SSOT (breadcraft.lang.json) into the app-facing vocabulary list.
 * The SINGLE place this transform lives: both the renderer (Monaco) and the
 * transpiler (lexer) build their vocabulary from here, so a name is known to the
 * editor and the transpiler in exactly the same way.
 */
export function buildVocabulary(data: Ssot): VocabItem[] {
  const items: VocabItem[] = []

  // entries[]: skip the { "$group": … } marker objects (no name).
  for (const entry of data.entries) {
    if (!entry.name || !entry.kind) continue
    const aliases = entry.aliases ?? []
    items.push({
      name: entry.name,
      kind: entry.kind,
      category: entry.category,
      params: entry.params ?? undefined,
      lookupKeys: [entry.name, ...aliases].map((k) => k.toLowerCase())
    })
  }

  // enum values → constants (UPPERCASE, e.g. BITMAP, JOY_LEFT, BLACK).
  for (const e of data.enums) {
    for (const v of e.values) {
      const aliases = v.aliases ?? []
      items.push({
        name: v.name,
        kind: 'constant',
        category: e.id,
        lookupKeys: [v.name, ...aliases].map((k) => k.toLowerCase())
      })
    }
  }

  // types (.b, .w, $ …) — included for completeness; symbol-y names.
  for (const t of data.types) {
    items.push({ name: t.name, kind: 'type', lookupKeys: [t.name.toLowerCase()] })
  }

  // operators[] — symbol ops (+ - * /) and word ops (And, Or, Mod, Shl, …). These
  // must be in the vocabulary so the lexer classifies `And` as an operator (not a
  // bare identifier) and the editor colours them; the symbol ops are also matched
  // by the lexer's operator scanner, but listing them keeps the vocabulary the one
  // complete picture of the language.
  for (const op of data.operators ?? []) {
    if (!op.name) continue
    const aliases = op.aliases ?? []
    items.push({
      name: op.name,
      kind: 'operator',
      category: op.category,
      lookupKeys: [op.name, ...aliases].map((k) => k.toLowerCase())
    })
  }

  return items
}

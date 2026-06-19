// Types for the parts of breadcraft.lang.json (the SSOT) the app consumes.
// Shared across processes: the renderer (Monaco intellisense + auto-casing) and
// the transpiler (lexer/parser) read the same vocabulary from here. Pure types +
// the flattened VocabItem shape — no Vue/Electron imports.

export type EntryKind =
  | 'function'
  | 'command'
  | 'keyword'
  | 'operator'
  | 'type'
  | 'constant'

export interface SsotParam {
  name: string
  type: string
  i18nKey?: string
  default?: string
  optional?: boolean
}

export interface SsotEntry {
  id: string
  name: string
  kind: EntryKind
  category?: string
  i18nKey?: string
  since?: string
  aliases?: string[]
  params?: SsotParam[]
  returns?: { type: string } | null
  // Hardware-honesty fields (consumed by the docs reference, D5): the same markers
  // the Health-Bars stand for. Optional — not every entry carries every field.
  cost?: 'free' | 'cheap' | 'medium' | 'expensive'
  frameSafe?: boolean
  proven?: boolean
  requiresMode?: string
  exampleId?: string
  transpile?: string
  // entries[] also contains marker objects like { "$group": "…" } with no id/name.
  $group?: string
}

export interface SsotEnumValue {
  name: string
  value: string | number
  i18nKey?: string
  since?: string
  aliases?: string[]
}

export interface SsotEnum {
  id: string
  i18nKey?: string
  values: SsotEnumValue[]
}

export interface SsotType {
  id: string
  name: string
  kind: 'type'
  i18nKey?: string
  category?: string
  cMapping?: string
  range?: [number, number]
  since?: string
}

export interface Ssot {
  $schemaVersion: string
  caseInsensitive?: boolean
  types: SsotType[]
  enums: SsotEnum[]
  entries: Array<Partial<SsotEntry>>
  /** Operators live in their own block (e.g. +, -, And, Or, Mod, Shl …). */
  operators?: Array<Partial<SsotEntry>>
  /** Language-neutral code snippets for docs, referenced by entry.exampleId. */
  examples?: Record<string, string>
}

/** A flattened, app-facing vocabulary item (built from the SSOT). */
export interface VocabItem {
  /** Canonical casing the editor offers and normalizes to. */
  name: string
  kind: EntryKind
  category?: string
  /** Lowercased name + aliases, for case-insensitive lookup. */
  lookupKeys: string[]
  params?: SsotParam[]
  /** SSOT `since: 'later'` → the word is a recognized part of the language but its
   *  codegen still throws an honest "no C-mapping / comes later" error (STAHL S5a).
   *  IntelliSense offers these visibly tagged as "planned", not as ready. Kept honest
   *  by an audit test against the codegen (vocabulary.planned.test.ts). */
  planned?: boolean
}

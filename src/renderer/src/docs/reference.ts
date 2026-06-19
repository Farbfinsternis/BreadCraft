import rawSsot from '@shared/breadcraft.lang.json'
import type { Ssot, SsotEntry } from '@shared/ssot-types'

/**
 * Reference-model generator (DOKU sprint, D5). Folds the SSOT
 * (breadcraft.lang.json) into the documentation reference — grouped by category,
 * with signatures, the hardware-honesty markers (cost/frameSafe/since/proven/
 * requiresMode), param tables, and code examples. Descriptions are resolved through
 * a translator `t` (the i18n engine in the app), so the reference stays localized
 * and can never drift from the language: a word exists in the docs iff it exists in
 * the SSOT (memory: breadcraft-ssot-langjson).
 *
 * Generated at RUNTIME from the imported SSOT — the same source the editor's
 * vocabulary is built from — rather than a separate build artifact that could drift.
 */
const ssot = rawSsot as unknown as Ssot

export interface RefParam {
  name: string
  type: string
  text: string
  optional: boolean
  default?: string
}

export interface RefEntry {
  id: string
  name: string
  kind: SsotEntry['kind']
  category: string
  signature: string
  returnType?: string
  text: string
  cost?: string
  frameSafe?: boolean
  since: string
  planned: boolean // since === 'later' → recognized but codegen not wired yet
  proven?: boolean
  requiresMode?: string
  params: RefParam[]
  example?: string
}

export interface RefEnumValue {
  name: string
  value: string | number
  text: string
  planned: boolean
}
export interface RefEnum {
  id: string
  text: string
  values: RefEnumValue[]
}
export interface RefType {
  id: string
  name: string
  text: string
  range?: [number, number]
  cMapping?: string
}
export interface RefGroup {
  category: string
  entries: RefEntry[]
}
export interface ReferenceModel {
  groups: RefGroup[]
  enums: RefEnum[]
  types: RefType[]
}

type Translate = (key: string) => string

/** The order categories appear in the reference — setup → world → logic → rest. */
const CATEGORY_ORDER = [
  'graphics-setup',
  'tiles',
  'sprites',
  'input',
  'frame',
  'branch',
  'loop',
  'flow',
  'declaration',
  'math',
  'string',
  'operator',
  'escape'
]

/**
 * A real entry, not a pure `{ $group }` marker. NOTE: some group markers are MERGED
 * into the first entry of their block (that object carries both `$group` and a real
 * id/name) while others stand alone. So identity is "has id + name" — a `$group`
 * field alongside them must NOT exclude the entry (else the first of each group,
 * e.g. `If`, silently vanishes).
 */
function isEntry(e: Partial<SsotEntry>): e is SsotEntry {
  return !!e && !!e.id && !!e.name
}

function allEntries(): SsotEntry[] {
  return [...(ssot.entries ?? []), ...(ssot.operators ?? [])].filter(isEntry)
}

function signatureOf(e: SsotEntry): string {
  const params = (e.params ?? []).map((p) =>
    p.optional || p.default !== undefined ? `[${p.name}]` : p.name
  )
  // Functions always take parens; commands list params after a space (none → bare).
  if (e.kind === 'function') return `${e.name}(${params.join(', ')})`
  return params.length ? `${e.name} ${params.join(', ')}` : e.name
}

/** Every i18nKey the SSOT declares for a description — the checklist the content
 *  must fill (used by the completeness test). */
export function collectI18nKeys(): string[] {
  const keys = new Set<string>()
  const add = (k?: string): void => {
    if (k) keys.add(k)
  }
  for (const e of allEntries()) {
    add(e.i18nKey)
    for (const p of e.params ?? []) add(p.i18nKey)
  }
  for (const ty of ssot.types ?? []) add(ty.i18nKey)
  for (const en of ssot.enums ?? []) {
    add(en.i18nKey)
    for (const v of en.values) add(v.i18nKey)
  }
  return [...keys]
}

export function buildReference(t: Translate): ReferenceModel {
  const byCat = new Map<string, RefEntry[]>()
  for (const e of allEntries()) {
    const category = e.category ?? 'other'
    const entry: RefEntry = {
      id: e.id,
      name: e.name,
      kind: e.kind,
      category,
      signature: signatureOf(e),
      returnType: e.returns?.type,
      text: e.i18nKey ? t(e.i18nKey) : '',
      cost: e.cost,
      frameSafe: e.frameSafe,
      since: e.since ?? 'phase1',
      planned: e.since === 'later',
      proven: e.proven,
      requiresMode: e.requiresMode,
      params: (e.params ?? []).map((p) => ({
        name: p.name,
        type: p.type,
        text: p.i18nKey ? t(p.i18nKey) : '',
        optional: !!p.optional || p.default !== undefined,
        default: p.default
      })),
      example: e.exampleId ? ssot.examples?.[e.exampleId] : undefined
    }
    if (!byCat.has(category)) byCat.set(category, [])
    byCat.get(category)!.push(entry)
  }

  const groups: RefGroup[] = []
  for (const cat of CATEGORY_ORDER) {
    if (byCat.has(cat)) groups.push({ category: cat, entries: byCat.get(cat)! })
  }
  // Any category not in the explicit order is appended (keeps every entry visible).
  for (const [cat, entries] of byCat) {
    if (!CATEGORY_ORDER.includes(cat)) groups.push({ category: cat, entries })
  }

  const enums: RefEnum[] = (ssot.enums ?? []).map((en) => ({
    id: en.id,
    text: en.i18nKey ? t(en.i18nKey) : '',
    values: en.values.map((v) => ({
      name: v.name,
      value: v.value,
      text: v.i18nKey ? t(v.i18nKey) : '',
      planned: v.since === 'later'
    }))
  }))

  const types: RefType[] = (ssot.types ?? []).map((ty) => ({
    id: ty.id,
    name: ty.name,
    text: ty.i18nKey ? t(ty.i18nKey) : '',
    range: ty.range,
    cMapping: ty.cMapping
  }))

  return { groups, enums, types }
}

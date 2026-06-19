import type { Locale } from '@shared/ipc'
import { DOC_PAGES, guideSource } from './registry'
import { parseSections } from './renderer'
import { buildReference } from './reference'
import { t } from '@renderer/i18n'

/**
 * Local, offline documentation search (DOKU sprint, D3 + full-text). The index is
 * built once from the bundled pages — page titles and every section's heading plus
 * its body prose AND code — so a query resolves instantly in the renderer, no index
 * server. The SSOT reference pages (D5) add their entries to this same index.
 */
export interface SearchEntry {
  pageId: string
  pageTitle: string
  slug?: string // section anchor; undefined = jump to the page top
  label: string // result title (section heading, or the page title)
  context: string // secondary line: page title for a section, group for a page
  snippet: string // excerpt of the body text around the first match (filled per query)
  heading: string // lowercased heading — for ranking (heading hit beats body-only)
  body: string // lowercased "heading + body" — what the query matches against
}

function buildIndex(locale: Locale): SearchEntry[] {
  const entries: SearchEntry[] = []
  const handbook = t('docs.group.handbook')
  for (const page of DOC_PAGES) {
    const title = t(page.titleKey)
    entries.push({
      pageId: page.id,
      pageTitle: title,
      label: title,
      context: handbook,
      snippet: '',
      heading: title.toLowerCase(),
      body: title.toLowerCase()
    })
    for (const section of parseSections(guideSource(page, locale))) {
      entries.push({
        pageId: page.id,
        pageTitle: title,
        slug: section.slug,
        label: section.heading,
        context: title,
        snippet: section.text,
        heading: section.heading.toLowerCase(),
        body: (section.heading + ' ' + section.text).toLowerCase()
      })
    }
  }

  // Reference (D5): every command/function/keyword/operator, enum value and type is
  // searchable by NAME + SIGNATURE. Built language-neutral (identity translator) so
  // the index needs no i18n at module load; localized descriptions stay out of the
  // haystack for now (D8). A hit jumps to the entry's reference page + anchor.
  const ref = buildReference((k) => k)
  for (const group of ref.groups) {
    for (const e of group.entries) {
      entries.push({
        pageId: `ref-${group.category}`,
        pageTitle: e.name,
        slug: e.id,
        label: e.name,
        context: e.signature,
        snippet: '',
        heading: e.name.toLowerCase(),
        body: `${e.name} ${e.signature}`.toLowerCase()
      })
    }
  }
  for (const en of ref.enums) {
    for (const v of en.values) {
      entries.push({
        pageId: 'ref-enums',
        pageTitle: v.name,
        slug: `enum-${en.id}`,
        label: v.name,
        context: en.id,
        snippet: '',
        heading: v.name.toLowerCase(),
        body: v.name.toLowerCase()
      })
    }
  }
  for (const ty of ref.types) {
    entries.push({
      pageId: 'ref-types',
      pageTitle: ty.name,
      slug: `type-${ty.id}`,
      label: ty.name,
      context: ty.cMapping ?? '',
      snippet: '',
      heading: ty.name.toLowerCase(),
      body: ty.name.toLowerCase()
    })
  }
  return entries
}

// One index per locale (guide titles/headings localize; reference names are neutral).
// Built lazily on first search in that language and cached.
const INDEX_CACHE = new Map<Locale, SearchEntry[]>()
function indexFor(locale: Locale): SearchEntry[] {
  let idx = INDEX_CACHE.get(locale)
  if (!idx) {
    idx = buildIndex(locale)
    INDEX_CACHE.set(locale, idx)
  }
  return idx
}

/**
 * Build a short excerpt around the first matched term, with ellipses. Returns ''
 * when no term occurs in the text — so a heading-only hit shows no misleading body
 * excerpt (the highlighted label already carries the match).
 *
 * The match is placed near the START of the excerpt (small `lead`, longer `trail`):
 * the result snippet is clamped to two lines in the UI, so a long lead-in would push
 * the highlighted word out of view and make the hit look wrong. Lead it instead.
 */
function excerpt(text: string, terms: string[], lead = 16, trail = 150): string {
  if (!text) return ''
  const lower = text.toLowerCase()
  let pos = -1
  for (const t of terms) {
    const p = lower.indexOf(t)
    if (p >= 0 && (pos < 0 || p < pos)) pos = p
  }
  if (pos < 0) return '' // no match in the body → don't show an unrelated excerpt
  const start = Math.max(0, pos - lead)
  const end = Math.min(text.length, pos + trail)
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}

/**
 * Match every whitespace-separated term as a substring (AND) against heading + body.
 * Ranking: page-title hits first, then sections whose heading matches, then body-only
 * hits — so the most on-topic result surfaces at the top. Capped for a tidy list.
 */
export function searchDocs(query: string, locale: Locale, limit = 20): SearchEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  const rank = (e: SearchEntry): number => {
    if (e.slug === undefined) return 0 // page-title entry
    if (terms.every((term) => e.heading.includes(term))) return 1 // heading hit
    return 2 // body-only hit
  }

  return indexFor(locale)
    .filter((e) => terms.every((term) => e.body.includes(term)))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit)
    .map((e) => ({ ...e, snippet: e.slug === undefined ? '' : excerpt(e.snippet, terms) }))
}

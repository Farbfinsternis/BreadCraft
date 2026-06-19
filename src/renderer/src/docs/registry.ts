import type { Locale } from '@shared/ipc'
import crumbSpracheDe from './guides/crumb-sprache.de.md?raw'

/**
 * One documentation page in the in-IDE reader (DOKU sprint, D2; localized in D8).
 * The registry is the single list the docs sidebar renders from. Guides are
 * authored German-first as `<id>.de.md` / `<id>.en.md` (bundled at build time,
 * never read from disk); `sources` holds the locales that exist. The title is an
 * i18n key so the sidebar label follows the IDE locale (memory: breadcraft-localization).
 * The SSOT-generated reference pages join the sidebar separately (D5).
 */
export interface DocPage {
  id: string // stable slug — the route param (/docs/:page) and the sidebar key
  titleKey: string // i18n key for the sidebar label
  sources: Partial<Record<Locale, string>> // raw Markdown per locale that exists
}

export const DOC_PAGES: DocPage[] = [
  {
    id: 'crumb-sprache',
    titleKey: 'docs.guide.crumb-sprache',
    sources: { de: crumbSpracheDe }
  }
]

/** Guides are written German-first; an absent translation falls back to it rather
 *  than hiding the page (show what exists). */
const GUIDE_FALLBACK: Locale = 'de'

/** The Markdown for a page in the active locale, falling back to the source language. */
export function guideSource(page: DocPage, locale: Locale): string {
  return page.sources[locale] ?? page.sources[GUIDE_FALLBACK] ?? Object.values(page.sources)[0] ?? ''
}

/** The page shown when /docs is opened without a specific page. */
export const DEFAULT_DOC_ID = DOC_PAGES[0].id

/** Resolve a route param to a page; falls back to the default page if unknown. */
export function findDocPage(id: string | undefined): DocPage {
  return DOC_PAGES.find((p) => p.id === id) ?? DOC_PAGES[0]
}

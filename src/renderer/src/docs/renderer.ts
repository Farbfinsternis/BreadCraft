import MarkdownIt from 'markdown-it'

/**
 * Code-block highlighter, injected by the view at runtime (setCrumbHighlighter). It
 * is injected rather than imported so this module stays free of Monaco: the search
 * index imports it in a plain Node test environment, where Monaco can't load. When
 * no highlighter is set, fences fall back to markdown-it's default escaping.
 */
type Highlighter = (code: string) => string
let highlighter: Highlighter | null = null

export function setCrumbHighlighter(fn: Highlighter): void {
  highlighter = fn
}

/**
 * The single Markdown→HTML renderer for the in-IDE documentation (DOKU sprint).
 * One source format (Markdown) feeds two surfaces — the IDE DocsView today and a
 * static BreadCraft website later (INLINE_DOCS_PLAN: "eine Quelle, zwei Oberflächen").
 *
 * SECURITY: `html: false` — raw HTML in the source is escaped, never passed through.
 * Our doc content is trusted (bundled at build time), but in an Electron renderer we
 * keep the door shut on principle: the rendered string is safe to bind with v-html.
 *
 * Code blocks are highlighted with the CRUMB tokenizer (D4). These are CRUMB docs, so
 * a bare fence is treated as CRUMB; an explicit non-crumb language is left untouched
 * (markdown-it escapes it). The highlighter returns escaped span markup, and we let
 * markdown-it wrap it in <pre><code>.
 */
const md = new MarkdownIt({
  html: false, // do not pass raw HTML through (see note above)
  linkify: true, // bare URLs become links
  typographer: true, // pretty quotes/dashes — matches the doc-voice prose
  // CRUMB docs: a bare fence is CRUMB; an explicit non-crumb language is left to
  // markdown-it's default escaping (''). No highlighter set → plain escaped block.
  highlight: (code, lang) =>
    (lang && lang !== 'crumb') || !highlighter ? '' : highlighter(code)
})

/** One entry in a page's table of contents (the "On this page" rail, D2). */
export interface TocEntry {
  level: number // 2 or 3 (h2/h3) — h1 is the page title, not a nav target
  text: string
  slug: string // matches the heading's id attribute → scroll/anchor target
}

/** A heading and the prose (+ code) beneath it, for full-text search (D3). */
export interface DocSection {
  slug: string // matches the heading id → search results anchor here
  heading: string
  level: number
  text: string // body text under the heading, markdown markup stripped
}

export interface RenderedDoc {
  html: string
  toc: TocEntry[]
  sections: DocSection[]
}

/**
 * URL-safe slug from heading text. German umlauts are transliterated so the slugs
 * stay readable and stable (they become heading ids → web deeplink targets in D9).
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Render a Markdown document to safe HTML plus its table of contents. Headings get
 * stable `id`s so the "On this page" rail can scroll to them (and so the future web
 * build can deep-link to them). Duplicate slugs are disambiguated with a suffix.
 */
/**
 * Walk the token stream once: assign stable ids to headings, collect the TOC, and
 * gather each section's body text (prose + code) for search. Mutates the tokens
 * (adds heading ids), so the caller renders the SAME tokens to keep ids in sync.
 */
function analyze(tokens: ReturnType<typeof md.parse>): { toc: TocEntry[]; sections: DocSection[] } {
  const toc: TocEntry[] = []
  const sections: DocSection[] = []
  const seen = new Map<string, number>()
  let current: DocSection | null = null

  let i = 0
  while (i < tokens.length) {
    const tk = tokens[i]
    if (tk.type === 'heading_open') {
      const text = tokens[i + 1]?.content ?? '' // the inline token holds the heading text

      let slug = slugify(text) || 'section'
      const n = seen.get(slug) ?? 0
      seen.set(slug, n + 1)
      if (n > 0) slug = `${slug}-${n}`
      tk.attrSet('id', slug)

      const level = Number(tk.tag.slice(1)) // 'h2' → 2
      if (level === 2 || level === 3) toc.push({ level, text, slug })

      current = { slug, heading: text, level, text: '' }
      sections.push(current)
      i += 3 // skip heading_open, its inline, heading_close — heading text isn't body
      continue
    }
    // Accumulate prose AND code (fences) under the current heading for full-text search.
    if (current && tk.content && (tk.type === 'inline' || tk.type === 'fence' || tk.type === 'code_block')) {
      current.text += (current.text ? ' ' : '') + tk.content
    }
    i++
  }

  // Strip markdown markup so matches and snippets read as plain prose.
  for (const s of sections) s.text = s.text.replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim()
  return { toc, sections }
}

export function renderDoc(source: string): RenderedDoc {
  const tokens = md.parse(source, {})
  const { toc, sections } = analyze(tokens)
  return { html: md.renderer.render(tokens, md.options, {}), toc, sections }
}

/**
 * Section text only — for the search index. Skips HTML rendering (and thus the CRUMB
 * highlighter), so the index can be built at module load without Monaco being ready.
 */
export function parseSections(source: string): DocSection[] {
  return analyze(md.parse(source, {})).sections
}

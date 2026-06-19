<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { renderDoc, setCrumbHighlighter } from '@renderer/docs/renderer'
import { DEFAULT_DOC_ID, DOC_PAGES, findDocPage, guideSource } from '@renderer/docs/registry'
import { buildReference, type RefEntry } from '@renderer/docs/reference'
import { searchDocs, type SearchEntry } from '@renderer/docs/search'
import { highlightCrumb } from '@renderer/docs/highlight'
import { useDocsStore } from '@renderer/stores/docs'
import CheatSheet from '@renderer/components/CheatSheet.vue'

/**
 * DocsView — the in-IDE documentation reader.
 *
 * Two content worlds share one reader: hand-written GUIDES (Markdown, D1–D4) and
 * the SSOT-generated REFERENCE (D5). D5b wires the reference into the sidebar; D6
 * renders each entry with its signature, the Health-Bar-honest badges (cost /
 * frame-safety / required mode / unproven), a parameter table and, where the SSOT
 * names an exampleId, a highlighted code example (D7) — grouped by category, plus
 * Types and Constants pages. Cross-links (needs an SSOT seeAlso field) are still to
 * come. The current page lives in the route (/docs/:page) and is deeplinkable; an
 * "On this page" rail tracks the visible entry.
 */
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const docsStore = useDocsStore()

setCrumbHighlighter(highlightCrumb)

// Open Help with no specific page → resume the last page read (D8 persistence).
if (!route.params.page && docsStore.lastPage) {
  router.replace({ name: 'docs', params: { page: docsStore.lastPage } })
}

const reference = computed(() => buildReference(t))

// ---- Sidebar navigation: Handbook (guides) + Reference (categories/types/enums) ----
interface NavItem {
  id: string
  title: string
}
const nav = computed<{ title: string; items: NavItem[] }[]>(() => [
  {
    title: t('docs.group.handbook'),
    items: DOC_PAGES.map((p) => ({ id: p.id, title: t(p.titleKey) }))
  },
  {
    title: t('docs.group.reference'),
    items: [
      { id: 'cheatsheet', title: t('docs.cheatsheet.title') },
      ...reference.value.groups.map((g) => ({
        id: `ref-${g.category}`,
        title: t(`docs.cat.${g.category}`)
      })),
      { id: 'ref-types', title: t('docs.ref.types') },
      { id: 'ref-enums', title: t('docs.ref.enums') }
    ]
  }
])

// ---- Which page is open? ----
const currentId = computed(() => (route.params.page as string | undefined) ?? DEFAULT_DOC_ID)
type PageKind = 'guide' | 'cheatsheet' | 'ref-category' | 'ref-types' | 'ref-enums'
const pageKind = computed<PageKind>(() => {
  const id = currentId.value
  if (id === 'cheatsheet') return 'cheatsheet'
  if (id === 'ref-types') return 'ref-types'
  if (id === 'ref-enums') return 'ref-enums'
  if (id.startsWith('ref-')) return 'ref-category'
  return 'guide'
})

const guide = computed(() => findDocPage(currentId.value))
const guideDoc = computed(() =>
  pageKind.value === 'guide' ? renderDoc(guideSource(guide.value, locale.value as 'de' | 'en')) : null
)

const category = computed(() => currentId.value.replace(/^ref-/, ''))
const categoryEntries = computed<RefEntry[]>(
  () => reference.value.groups.find((g) => g.category === category.value)?.entries ?? []
)

// Cost → colour band for the badge (free=good … expensive=danger). Keeps the
// Health-Bar honesty visible right in the reference (memory: breadcraft-health-bars).
function costClass(cost?: string): string {
  return cost ? `is-${cost}` : ''
}

const pageTitle = computed(() => {
  switch (pageKind.value) {
    case 'guide':
      return t(guide.value.titleKey)
    case 'ref-types':
      return t('docs.ref.types')
    case 'ref-enums':
      return t('docs.ref.enums')
    default:
      return t(`docs.cat.${category.value}`)
  }
})

// "On this page" anchors per page kind.
const toc = computed<{ text: string; slug: string }[]>(() => {
  switch (pageKind.value) {
    case 'guide':
      return guideDoc.value?.toc.map((e) => ({ text: e.text, slug: e.slug })) ?? []
    case 'ref-category':
      return categoryEntries.value.map((e) => ({ text: e.name, slug: e.id }))
    case 'ref-types':
      return reference.value.types.map((ty) => ({ text: ty.name, slug: `type-${ty.id}` }))
    case 'ref-enums':
      return reference.value.enums.map((en) => ({ text: en.id, slug: `enum-${en.id}` }))
    default:
      return [] // cheatsheet has its own controls, no "on this page"
  }
})

const mainEl = ref<HTMLElement | null>(null)
const activeSlug = ref('')

// ---- Local search ----
const query = ref('')
const selIndex = ref(0)
const results = computed(() => searchDocs(query.value, locale.value as 'de' | 'en'))
const terms = computed(() => query.value.trim().toLowerCase().split(/\s+/).filter(Boolean))
let pendingSlug: string | null = null

function selectPage(id: string): void {
  if (id !== currentId.value) router.push({ name: 'docs', params: { page: id } })
}

function scrollTo(slug: string): void {
  const el = mainEl.value?.querySelector<HTMLElement>(`#${CSS.escape(slug)}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function goToResult(entry: SearchEntry): void {
  if (entry.pageId === currentId.value) {
    if (entry.slug) scrollTo(entry.slug)
    else if (mainEl.value) mainEl.value.scrollTop = 0
  } else {
    pendingSlug = entry.slug ?? null
    router.push({ name: 'docs', params: { page: entry.pageId } })
  }
  query.value = ''
}

function onSearchKey(ev: KeyboardEvent): void {
  const list = results.value
  if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    if (list.length) selIndex.value = (selIndex.value + 1) % list.length
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    if (list.length) selIndex.value = (selIndex.value - 1 + list.length) % list.length
  } else if (ev.key === 'Enter') {
    ev.preventDefault()
    if (list[selIndex.value]) goToResult(list[selIndex.value])
  } else if (ev.key === 'Escape') {
    query.value = ''
  }
}

watch(results, () => {
  selIndex.value = 0
})

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )
}

/** Escape text, then wrap query-term matches in <mark>. Safe for v-html. */
function highlight(text: string): string {
  const ts = terms.value
  if (!ts.length || !text) return escapeHtml(text)
  const re = new RegExp(`(${ts.map((t2) => t2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out += escapeHtml(text.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>'
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return out + escapeHtml(text.slice(last))
}

// ---- Scroll-spy: active section is the last heading scrolled past the top edge ----
let rafId = 0
function updateActive(): void {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    const root = mainEl.value
    if (!root) return
    const heads = root.querySelectorAll<HTMLElement>('h2[id], h3[id]')
    const threshold = root.getBoundingClientRect().top + 90
    let current = ''
    heads.forEach((h) => {
      if (h.getBoundingClientRect().top <= threshold) current = h.id
    })
    if (!current && heads.length) current = heads[0].id
    activeSlug.value = current
  })
}

// ---- Persist last page + per-page scroll position (D8) ----
function saveScroll(pageId: string): void {
  if (mainEl.value) docsStore.rememberScroll(pageId, mainEl.value.scrollTop)
}
let scrollSaveTimer = 0
// Throttle scroll persistence: the spy runs every frame, but writing localStorage on
// every frame would be wasteful — record the position at most ~every 400ms.
function onScroll(): void {
  updateActive()
  if (scrollSaveTimer) return
  scrollSaveTimer = window.setTimeout(() => {
    scrollSaveTimer = 0
    saveScroll(currentId.value)
  }, 400)
}

// React to the page AND to a ?at=<slug> jump target (set by the cheat sheet, or a
// deeplink). The query path lets another component scroll us to a section without
// reaching into this component's internals.
watch(
  [currentId, () => route.query.at],
  (_now, prev) => {
    const prevPage = prev?.[0] as string | undefined
    if (prevPage && prevPage !== currentId.value) saveScroll(prevPage) // leaving a page
    docsStore.setLastPage(currentId.value)
    nextTick(() => {
      const at = route.query.at as string | undefined
      if (at) {
        scrollTo(at)
      } else if (pendingSlug) {
        scrollTo(pendingSlug)
        pendingSlug = null
      } else if (mainEl.value) {
        mainEl.value.scrollTop = docsStore.scroll[currentId.value] ?? 0 // resume position
      }
      updateActive()
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  saveScroll(currentId.value) // leaving the docs view entirely
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="docs">
    <!-- Left: search + navigation -->
    <nav class="docs-nav" aria-label="Dokumentation">
      <div class="docs-search">
        <svg class="docs-search-ico ico-sm" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          v-model="query"
          class="docs-search-input"
          type="search"
          :placeholder="t('docs.search.placeholder')"
          :aria-label="t('docs.search.placeholder')"
          @keydown="onSearchKey"
        />
      </div>

      <div v-if="query" class="docs-results">
        <button
          v-for="(r, i) in results"
          :key="r.pageId + (r.slug ?? '')"
          class="docs-result"
          :class="{ 'is-active': i === selIndex }"
          @click="goToResult(r)"
          @mouseenter="selIndex = i"
        >
          <!-- eslint-disable-next-line vue/no-v-html — highlight() escapes its input -->
          <span class="docs-result-label" v-html="highlight(r.label)" />
          <span class="docs-result-context">{{ r.context }}</span>
          <!-- eslint-disable-next-line vue/no-v-html — highlight() escapes its input -->
          <span v-if="r.snippet" class="docs-result-snippet" v-html="highlight(r.snippet)" />
        </button>
        <p v-if="!results.length" class="docs-results-empty bc-body-sm">
          {{ t('docs.search.empty') }}
        </p>
      </div>

      <template v-for="section in nav" v-else :key="section.title">
        <div class="docs-nav-group bc-label">{{ section.title }}</div>
        <button
          v-for="item in section.items"
          :key="item.id"
          class="docs-nav-item"
          :class="{ 'is-active': item.id === currentId }"
          @click="selectPage(item.id)"
        >
          {{ item.title }}
        </button>
      </template>
    </nav>

    <!-- Centre: the scroll container the spy watches -->
    <main ref="mainEl" class="docs-main" @scroll="onScroll">
      <!-- Cheat sheet (filterable card grid over the whole language) -->
      <CheatSheet v-if="pageKind === 'cheatsheet'" />

      <!-- Guide page (Markdown) -->
      <!-- eslint-disable-next-line vue/no-v-html — markdown-it escapes raw HTML -->
      <article v-else-if="pageKind === 'guide'" class="docs-body" v-html="guideDoc!.html" />

      <!-- Reference pages (generated) -->
      <article v-else class="docs-body docs-ref">
        <h1>{{ pageTitle }}</h1>

        <!-- Commands / functions / keywords / operators by category -->
        <template v-if="pageKind === 'ref-category'">
          <section v-for="e in categoryEntries" :key="e.id" class="ref-entry">
            <h3 :id="e.id">
              {{ e.name }}
              <span v-if="e.planned" class="ref-planned">⏳ {{ t('docs.planned') }}</span>
            </h3>
            <code class="ref-sig">{{ e.signature
              }}<span v-if="e.returnType" class="ref-ret"> → {{ e.returnType }}</span></code>

            <!-- Honesty badges: cost, frame-safety, required mode, unproven -->
            <div v-if="e.cost || e.frameSafe != null || e.requiresMode || (e.proven === false && !e.planned)" class="ref-badges">
              <span
                v-if="e.cost"
                class="ref-badge"
                :class="costClass(e.cost)"
                :title="t('docs.cost.label')"
              >{{ t(`docs.cost.${e.cost}`) }}</span>
              <span v-if="e.frameSafe === true" class="ref-badge is-frame">{{ t('docs.frameSafe.yes') }}</span>
              <span v-else-if="e.frameSafe === false" class="ref-badge is-noframe">{{ t('docs.frameSafe.no') }}</span>
              <span v-if="e.requiresMode" class="ref-badge is-mode">{{ t('docs.needsMode', { mode: e.requiresMode }) }}</span>
              <span v-if="e.proven === false && !e.planned" class="ref-badge is-unproven">⚠ {{ t('docs.unproven') }}</span>
            </div>

            <p v-if="e.text" class="ref-text">{{ e.text }}</p>

            <!-- Parameter table -->
            <table v-if="e.params.length" class="ref-params">
              <thead>
                <tr>
                  <th>{{ t('docs.params') }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in e.params" :key="p.name">
                  <td class="ref-param-name">
                    <code>{{ p.name }}</code>
                    <span class="ref-param-type">{{ p.type }}</span>
                    <span v-if="p.optional" class="ref-param-opt">{{ t('docs.param.optional') }}</span>
                    <span v-if="p.default !== undefined" class="ref-param-def">= {{ p.default }}</span>
                  </td>
                  <td class="ref-param-text">{{ p.text }}</td>
                </tr>
              </tbody>
            </table>

            <!-- Code example (D7) — highlighted with the same tokenizer as the editor -->
            <figure v-if="e.example" class="ref-example">
              <figcaption class="bc-label">{{ t('docs.example') }}</figcaption>
              <!-- eslint-disable-next-line vue/no-v-html — highlightCrumb escapes its input -->
              <pre><code v-html="highlightCrumb(e.example)" /></pre>
            </figure>
          </section>
        </template>

        <!-- Types -->
        <template v-else-if="pageKind === 'ref-types'">
          <section v-for="ty in reference.types" :key="ty.id" class="ref-entry">
            <h3 :id="`type-${ty.id}`">
              {{ ty.name }}
              <span v-if="ty.range" class="ref-range">{{ ty.range[0] }} … {{ ty.range[1] }}</span>
            </h3>
            <p v-if="ty.text" class="ref-text">{{ ty.text }}</p>
          </section>
        </template>

        <!-- Enums / constants -->
        <template v-else>
          <section v-for="en in reference.enums" :key="en.id" class="ref-entry">
            <h3 :id="`enum-${en.id}`">{{ en.id }}</h3>
            <p v-if="en.text" class="ref-text">{{ en.text }}</p>
            <dl class="ref-values">
              <template v-for="v in en.values" :key="v.name">
                <dt>
                  {{ v.name }}
                  <span v-if="v.planned" class="ref-planned">⏳ {{ t('docs.planned') }}</span>
                </dt>
                <dd>{{ v.text }}</dd>
              </template>
            </dl>
          </section>
        </template>
      </article>
    </main>

    <!-- Right: "On this page" -->
    <aside v-if="toc.length" class="docs-toc" :aria-label="t('docs.onThisPage')">
      <div class="docs-toc-title bc-label">{{ t('docs.onThisPage') }}</div>
      <button
        v-for="entry in toc"
        :key="entry.slug"
        class="docs-toc-item"
        :class="{ 'is-active': entry.slug === activeSlug }"
        @click="scrollTo(entry.slug)"
      >
        {{ entry.text }}
      </button>
    </aside>
  </div>
</template>

<style scoped>
.docs {
  display: flex;
  height: 100%;
  overflow: hidden;
  container-type: inline-size;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(30, 45, 77, 0.22), transparent 55%),
    var(--bc-navy-900);
}

/* ---- Left: navigation ---- */
.docs-nav {
  flex: 0 0 232px;
  overflow-y: auto;
  padding: var(--bc-space-5) var(--bc-space-3);
  border-right: 1px solid var(--bc-border);
  background: var(--bc-navy-1000);
}

.docs-search {
  position: relative;
  margin-bottom: var(--bc-space-3);
}
.docs-search-ico {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--bc-text-400);
  pointer-events: none;
}
.docs-search-input {
  width: 100%;
  padding: 7px 10px 7px 30px;
  background: var(--bc-navy-900);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-sm);
  color: var(--bc-text-100);
  font-family: var(--bc-font-sans);
  font-size: 13px;
  outline: none;
  transition: border-color 110ms ease, box-shadow 110ms ease;
}
.docs-search-input::placeholder {
  color: var(--bc-text-400);
}
.docs-search-input:focus {
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}

.docs-results {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.docs-result {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--bc-radius-sm);
  background: transparent;
  cursor: pointer;
}
.docs-result.is-active {
  background: var(--bc-grad-arc-soft);
  border-color: var(--bc-border-strong);
}
.docs-result-label {
  color: var(--bc-text-100);
  font-size: 13px;
  line-height: 1.3;
}
.docs-result-context {
  color: var(--bc-text-400);
  font-size: 11px;
  line-height: 1.2;
  font-family: var(--bc-font-mono);
}
.docs-result-snippet {
  margin-top: 2px;
  color: var(--bc-text-300);
  font-size: 11.5px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.docs-result :deep(mark) {
  background: rgba(94, 196, 255, 0.22);
  color: var(--bc-arc-100);
  border-radius: 2px;
  padding: 0 1px;
}
.docs-results-empty {
  padding: var(--bc-space-2) var(--bc-space-2) 0;
  color: var(--bc-text-400);
}

.docs-nav-group {
  display: block;
  margin: var(--bc-space-4) var(--bc-space-2) var(--bc-space-2);
}
.docs-nav-group:first-of-type {
  margin-top: 0;
}
.docs-nav-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  margin-bottom: 2px;
  border: 1px solid transparent;
  border-radius: var(--bc-radius-sm);
  background: transparent;
  color: var(--bc-text-300);
  font-family: var(--bc-font-sans);
  font-size: 13px;
  line-height: 1.35;
  cursor: pointer;
  transition: all 110ms ease;
}
.docs-nav-item:hover {
  background: var(--bc-bg-elev-1);
  color: var(--bc-text-100);
}
.docs-nav-item.is-active {
  background: var(--bc-grad-arc-soft);
  border-color: var(--bc-border-strong);
  color: var(--bc-arc-200);
  font-weight: 500;
}

/* ---- Centre: reading column ---- */
.docs-main {
  flex: 1 1 auto;
  overflow-y: auto;
  scroll-behavior: smooth;
}
.docs-body {
  max-width: 72ch;
  margin: 0 auto;
  padding: var(--bc-space-7) var(--bc-space-6) var(--bc-space-8);
  color: var(--bc-fg);
  font-family: var(--bc-font-sans);
  font-size: 16px;
  line-height: 1.6;
  text-wrap: pretty;
}

.docs-body :deep(h1),
.docs-body h1 {
  font-family: var(--bc-font-display);
  font-weight: 800;
  font-size: 38px;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--bc-fg-strong);
  margin: 0 0 var(--bc-space-5);
  scroll-margin-top: var(--bc-space-5);
}
.docs-body :deep(h2) {
  font-family: var(--bc-font-display);
  font-weight: 700;
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--bc-fg-strong);
  margin: var(--bc-space-7) 0 var(--bc-space-3);
  padding-bottom: var(--bc-space-2);
  border-bottom: 1px solid var(--bc-border);
  scroll-margin-top: var(--bc-space-5);
}
.docs-body :deep(h3) {
  font-family: var(--bc-font-display);
  font-weight: 600;
  font-size: 19px;
  line-height: 1.25;
  color: var(--bc-fg-strong);
  margin: var(--bc-space-5) 0 var(--bc-space-2);
  scroll-margin-top: var(--bc-space-5);
}
.docs-body :deep(p) {
  margin: 0 0 var(--bc-space-4);
}
.docs-body :deep(ul),
.docs-body :deep(ol) {
  margin: 0 0 var(--bc-space-4);
  padding-left: var(--bc-space-5);
}
.docs-body :deep(li) {
  margin-bottom: var(--bc-space-1);
}
.docs-body :deep(strong) {
  color: var(--bc-fg-strong);
  font-weight: 600;
}
.docs-body :deep(a) {
  color: var(--bc-link);
  text-decoration: none;
  border-bottom: 1px solid var(--bc-border-strong);
}
.docs-body :deep(a:hover) {
  color: var(--bc-link-hover);
}
.docs-body :deep(hr) {
  border: 0;
  border-top: 1px solid var(--bc-border);
  margin: var(--bc-space-6) 0;
}
.docs-body :deep(:not(pre) > code) {
  font-family: var(--bc-font-mono);
  font-size: 0.88em;
  color: var(--bc-arc-200);
  background: rgba(94, 196, 255, 0.07);
  border: 1px solid var(--bc-border-subtle);
  border-radius: var(--bc-radius-sm);
  padding: 1px 5px;
}
.docs-body :deep(pre) {
  margin: 0 0 var(--bc-space-4);
  padding: var(--bc-space-4);
  background: var(--bc-navy-1000);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  box-shadow: var(--bc-bevel);
  overflow-x: auto;
}
.docs-body :deep(pre code) {
  font-family: var(--bc-font-mono);
  font-size: 13px;
  line-height: 1.5;
  color: var(--bc-text-200);
}
.docs-body :deep(blockquote) {
  margin: 0 0 var(--bc-space-4);
  padding: var(--bc-space-2) var(--bc-space-4);
  border-left: 3px solid var(--bc-copper-300);
  background: rgba(230, 154, 85, 0.06);
  border-radius: 0 var(--bc-radius-sm) var(--bc-radius-sm) 0;
  color: var(--bc-fg-muted);
}
.docs-body :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

/* ---- Reference entries (D6: signature + honesty badges + param table) ---- */
.ref-entry {
  margin-bottom: var(--bc-space-5);
  padding-bottom: var(--bc-space-4);
  border-bottom: 1px solid var(--bc-border-subtle);
}
.ref-entry h3 {
  display: flex;
  align-items: baseline;
  gap: var(--bc-space-3);
}

/* Honesty badges — cost band, frame-safety, mode, unproven */
.ref-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bc-space-2);
  margin-bottom: var(--bc-space-3);
}
.ref-badge {
  font-family: var(--bc-font-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 2px 8px;
  border-radius: var(--bc-radius-pill);
  border: 1px solid var(--bc-border);
  color: var(--bc-text-300);
  background: var(--bc-bg-elev-1);
  white-space: nowrap;
}
/* cost bands: free=good → expensive=danger */
.ref-badge.is-free {
  color: var(--bc-success);
  border-color: color-mix(in srgb, var(--bc-success) 40%, transparent);
  background: color-mix(in srgb, var(--bc-success) 12%, transparent);
}
.ref-badge.is-cheap {
  color: var(--bc-arc-200);
  border-color: var(--bc-border-strong);
  background: var(--bc-grad-arc-soft);
}
.ref-badge.is-medium {
  color: var(--bc-copper-200);
  border-color: color-mix(in srgb, var(--bc-copper-300) 40%, transparent);
  background: color-mix(in srgb, var(--bc-copper-300) 12%, transparent);
}
.ref-badge.is-expensive {
  color: var(--bc-danger);
  border-color: color-mix(in srgb, var(--bc-danger) 45%, transparent);
  background: color-mix(in srgb, var(--bc-danger) 12%, transparent);
}
.ref-badge.is-frame {
  color: var(--bc-success);
  border-color: color-mix(in srgb, var(--bc-success) 35%, transparent);
}
.ref-badge.is-noframe,
.ref-badge.is-unproven {
  color: var(--bc-warning);
  border-color: color-mix(in srgb, var(--bc-warning) 40%, transparent);
  background: color-mix(in srgb, var(--bc-warning) 10%, transparent);
}
.ref-badge.is-mode {
  color: var(--bc-copper-200);
  font-family: var(--bc-font-mono);
}

/* Parameter table */
.ref-params {
  width: 100%;
  border-collapse: collapse;
  margin: var(--bc-space-3) 0 0;
}
.ref-params th {
  text-align: left;
  font-family: var(--bc-font-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--bc-text-400);
  padding: 0 var(--bc-space-4) var(--bc-space-1) 0;
  border-bottom: 1px solid var(--bc-border-subtle);
}
.ref-params td {
  vertical-align: top;
  padding: var(--bc-space-2) var(--bc-space-4) var(--bc-space-2) 0;
  border-bottom: 1px solid var(--bc-border-subtle);
}
.ref-params tr:last-child td {
  border-bottom: 0;
}
.ref-param-name {
  white-space: nowrap;
}
.ref-param-name code {
  font-family: var(--bc-font-mono);
  font-size: 13px;
  color: var(--bc-copper-200);
}
.ref-param-type {
  margin-left: var(--bc-space-2);
  font-family: var(--bc-font-mono);
  font-size: 12px;
  color: var(--bc-text-400);
}
.ref-param-opt {
  margin-left: var(--bc-space-2);
  font-size: 10.5px;
  font-style: italic;
  color: var(--bc-text-400);
}
.ref-param-def {
  margin-left: var(--bc-space-2);
  font-family: var(--bc-font-mono);
  font-size: 12px;
  color: var(--bc-arc-300);
}
.ref-param-text {
  width: 100%;
  color: var(--bc-fg-muted);
  font-size: 14px;
  line-height: 1.5;
}

/* Code example (D7) */
.ref-example {
  margin: var(--bc-space-3) 0 0;
}
.ref-example figcaption,
.ref-example :deep(figcaption) {
  display: block;
  margin-bottom: var(--bc-space-1);
  color: var(--bc-copper-300);
}
.ref-example pre {
  margin: 0;
  padding: var(--bc-space-3) var(--bc-space-4);
  background: var(--bc-navy-1000);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  box-shadow: var(--bc-bevel);
  overflow-x: auto;
}
.ref-example code {
  font-family: var(--bc-font-mono);
  font-size: 13px;
  line-height: 1.5;
  color: var(--bc-text-200);
  white-space: pre;
}
.ref-sig {
  display: block;
  font-family: var(--bc-font-mono);
  font-size: 13px;
  color: var(--bc-arc-200);
  background: var(--bc-navy-1000);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-sm);
  padding: 6px 10px;
  margin-bottom: var(--bc-space-2);
  overflow-x: auto;
}
.ref-ret {
  color: var(--bc-text-400);
}
.ref-text {
  margin: 0;
  color: var(--bc-fg);
}
.ref-planned {
  font-family: var(--bc-font-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--bc-warning);
}
.ref-range {
  font-family: var(--bc-font-mono);
  font-size: 12px;
  font-weight: 400;
  color: var(--bc-text-400);
}
.ref-values {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--bc-space-1) var(--bc-space-4);
  margin: var(--bc-space-2) 0 0;
}
.ref-values dt {
  font-family: var(--bc-font-mono);
  font-size: 13px;
  color: var(--bc-copper-200);
  white-space: nowrap;
}
.ref-values dd {
  margin: 0;
  color: var(--bc-fg-muted);
  font-size: 14px;
}

/* ---- Right: "On this page" ---- */
.docs-toc {
  flex: 0 0 216px;
  overflow-y: auto;
  padding: var(--bc-space-7) var(--bc-space-3) var(--bc-space-5);
  border-left: 1px solid var(--bc-border);
}
.docs-toc-title {
  display: block;
  margin: 0 var(--bc-space-2) var(--bc-space-3);
}
.docs-toc-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 10px;
  border: 0;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--bc-text-400);
  font-family: var(--bc-font-sans);
  font-size: 12.5px;
  line-height: 1.4;
  cursor: pointer;
  transition: color 110ms ease, border-color 110ms ease;
}
.docs-toc-item:hover {
  color: var(--bc-text-100);
}
.docs-toc-item.is-active {
  color: var(--bc-arc-200);
  border-left-color: var(--bc-arc-400);
}

@container (max-width: 760px) {
  .docs-toc {
    display: none;
  }
}
</style>

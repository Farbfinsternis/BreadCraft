<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { buildReference, type RefEntry } from '@renderer/docs/reference'
import { highlightCrumb } from '@renderer/docs/highlight'

/**
 * Cheat sheet — the whole language at a glance (DOKU sprint, pulled forward at the
 * user's request; modelled on BASSM's). A filterable card grid generated from the
 * same SSOT reference model as D5: each card shows name + kind + signature +
 * short description, and jumps to the detailed reference page on click. Search
 * narrows by name/signature/description; the chips filter by kind (with counts).
 */
const { t } = useI18n()
const router = useRouter()

const KIND_BADGE: Record<string, string> = {
  command: 'CMD',
  function: 'FN',
  keyword: 'KW',
  operator: 'OP'
}
const KINDS = ['command', 'function', 'keyword', 'operator'] as const

interface Card extends RefEntry {
  sigHtml: string
}

// Flatten the reference groups, keeping category order. Signatures are highlighted
// once here (not per render) with the same tokenizer the editor uses.
const cards = computed<Card[]>(() =>
  buildReference(t).groups.flatMap((g) =>
    g.entries.map((e) => ({ ...e, sigHtml: highlightCrumb(e.signature) }))
  )
)

const counts = computed<Record<string, number>>(() => {
  const c: Record<string, number> = {}
  for (const card of cards.value) c[card.kind] = (c[card.kind] ?? 0) + 1
  return c
})

const activeKind = ref<string | null>(null) // null = all
const query = ref('')

const filtered = computed<Card[]>(() => {
  const q = query.value.trim().toLowerCase()
  return cards.value.filter((c) => {
    if (activeKind.value && c.kind !== activeKind.value) return false
    if (!q) return true
    return (
      c.name.toLowerCase().includes(q) ||
      c.signature.toLowerCase().includes(q) ||
      c.text.toLowerCase().includes(q)
    )
  })
})

// Group the filtered cards by category, preserving the reference order. Categories
// with no matching card drop out entirely.
const sections = computed<{ category: string; cards: Card[] }[]>(() => {
  const out: { category: string; cards: Card[] }[] = []
  for (const card of filtered.value) {
    let section = out.find((s) => s.category === card.category)
    if (!section) {
      section = { category: card.category, cards: [] }
      out.push(section)
    }
    section.cards.push(card)
  }
  return out
})

function openEntry(card: Card): void {
  router.push({ name: 'docs', params: { page: `ref-${card.category}` }, query: { at: card.id } })
}
</script>

<template>
  <div class="cheat">
    <h1>{{ t('docs.cheatsheet.title') }}</h1>
    <p class="cheat-sub">{{ t('docs.cheatsheet.subtitle') }}</p>

    <div class="cheat-controls">
      <input
        v-model="query"
        class="cheat-search"
        type="search"
        :placeholder="t('docs.cheatsheet.searchPlaceholder')"
        :aria-label="t('docs.cheatsheet.searchPlaceholder')"
      />
      <div class="cheat-chips">
        <button
          class="cheat-chip"
          :class="{ 'is-active': activeKind === null }"
          @click="activeKind = null"
        >
          {{ t('docs.cheatsheet.all') }} <span class="cheat-chip-count">{{ cards.length }}</span>
        </button>
        <button
          v-for="k in KINDS"
          :key="k"
          class="cheat-chip"
          :class="{ 'is-active': activeKind === k }"
          @click="activeKind = activeKind === k ? null : k"
        >
          {{ t(`docs.kind.${k}`) }} <span class="cheat-chip-count">{{ counts[k] ?? 0 }}</span>
        </button>
      </div>
    </div>

    <p v-if="!filtered.length" class="cheat-empty bc-body-sm">{{ t('docs.search.empty') }}</p>

    <section v-for="s in sections" :key="s.category" class="cheat-section">
      <h2 class="cheat-cat bc-label">{{ t(`docs.cat.${s.category}`) }}</h2>
      <div class="cheat-grid">
        <button v-for="c in s.cards" :key="c.id" class="cheat-card" @click="openEntry(c)">
          <div class="cheat-card-head">
            <span class="cheat-name">{{ c.name }}</span>
            <span class="cheat-badge">{{ KIND_BADGE[c.kind] ?? c.kind }}</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html — highlightCrumb escapes its input -->
          <code class="cheat-sig" v-html="c.sigHtml" />
          <p v-if="c.text" class="cheat-text">{{ c.text }}</p>
          <span class="cheat-open">
            <span v-if="c.planned" class="cheat-planned">⏳ {{ t('docs.planned') }}</span>
            {{ t('docs.cheatsheet.toRef') }}
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cheat {
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--bc-space-7) var(--bc-space-6) var(--bc-space-8);
}
.cheat h1 {
  font-family: var(--bc-font-display);
  font-weight: 800;
  font-size: 38px;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--bc-fg-strong);
  margin: 0 0 var(--bc-space-2);
}
.cheat-sub {
  color: var(--bc-fg-muted);
  font-size: 15px;
  margin: 0 0 var(--bc-space-5);
}

/* Controls: search + kind chips */
.cheat-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bc-space-3);
  align-items: center;
  margin-bottom: var(--bc-space-6);
}
.cheat-search {
  flex: 1 1 280px;
  padding: 9px 12px;
  background: var(--bc-navy-900);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-sm);
  color: var(--bc-text-100);
  font-family: var(--bc-font-sans);
  font-size: 14px;
  outline: none;
  transition: border-color 110ms ease, box-shadow 110ms ease;
}
.cheat-search:focus {
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.cheat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bc-space-2);
}
.cheat-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-pill);
  background: transparent;
  color: var(--bc-text-300);
  font-family: var(--bc-font-sans);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 110ms ease;
}
.cheat-chip:hover {
  border-color: var(--bc-border-strong);
  color: var(--bc-text-100);
}
.cheat-chip.is-active {
  border-color: var(--bc-arc-400);
  background: var(--bc-grad-arc-soft);
  color: var(--bc-arc-200);
}
.cheat-chip-count {
  font-family: var(--bc-font-mono);
  font-size: 11px;
  color: var(--bc-text-400);
}
.cheat-chip.is-active .cheat-chip-count {
  color: var(--bc-arc-300);
}

.cheat-empty {
  color: var(--bc-text-400);
}

/* Category section + card grid */
.cheat-section {
  margin-bottom: var(--bc-space-6);
}
.cheat-cat {
  display: block;
  color: var(--bc-copper-300);
  margin: 0 0 var(--bc-space-3);
}
.cheat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--bc-space-3);
}

.cheat-card {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  text-align: left;
  padding: var(--bc-space-3) var(--bc-space-4);
  background: var(--bc-bg-elev-1);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
  transition: border-color 110ms ease, box-shadow 110ms ease, transform 110ms ease;
}
.cheat-card:hover {
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.cheat-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bc-space-2);
}
.cheat-name {
  font-family: var(--bc-font-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--bc-fg-strong);
}
.cheat-badge {
  font-family: var(--bc-font-sans);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--bc-arc-300);
  background: rgba(94, 196, 255, 0.1);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-xs);
  padding: 2px 5px;
}
.cheat-sig {
  display: block;
  font-family: var(--bc-font-mono);
  font-size: 12.5px;
  color: var(--bc-arc-200);
  background: var(--bc-navy-1000);
  border: 1px solid var(--bc-border-subtle);
  border-radius: var(--bc-radius-sm);
  padding: 5px 8px;
  overflow-x: auto;
  white-space: nowrap;
}
.cheat-text {
  margin: 0;
  color: var(--bc-fg-muted);
  font-size: 13px;
  line-height: 1.45;
  /* keep cards even: clamp the gloss to three lines */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cheat-open {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--bc-arc-400);
}
.cheat-planned {
  color: var(--bc-warning);
  font-weight: 600;
}
</style>

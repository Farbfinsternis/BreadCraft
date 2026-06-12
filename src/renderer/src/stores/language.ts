import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import rawSsot from '@shared/breadcraft.lang.json'
import type { Ssot, VocabItem } from '@renderer/language/ssot'
import { buildVocabulary } from '@shared/vocabulary'

const ssot = rawSsot as unknown as Ssot

/**
 * Language store: the single in-app representation of the SSOT
 * (breadcraft.lang.json). Feeds Monaco intellisense (completion, auto-casing)
 * and later the transpiler-side checks. See _plans/BREADCRAFT_IDE.md §1.1.
 */
export const useLanguageStore = defineStore('language', () => {
  const vocabulary = ref<VocabItem[]>(buildVocabulary(ssot))
  const caseInsensitive = ref<boolean>(ssot.caseInsensitive ?? true)

  // Lowercased lookup-key → canonical name + grammar kind, for auto-casing typed
  // identifiers. The kind lets auto-casing be conservative under case-sensitivity:
  // a lowercase word that folds to a keyword/command in a value spot is almost surely
  // a variable, not a miscased CRUMB word (EISEN M2.T2b / N4).
  const canonicalByKey = computed(() => {
    const map = new Map<string, { name: string; kind: VocabItem['kind'] }>()
    for (const item of vocabulary.value) {
      for (const key of item.lookupKeys) {
        if (!map.has(key)) map.set(key, { name: item.name, kind: item.kind })
      }
    }
    return map
  })

  function canonicalize(word: string): string | undefined {
    return canonicalByKey.value.get(word.toLowerCase())?.name
  }

  function canonicalInfo(word: string): { name: string; kind: VocabItem['kind'] } | undefined {
    return canonicalByKey.value.get(word.toLowerCase())
  }

  return { vocabulary, caseInsensitive, canonicalByKey, canonicalize, canonicalInfo }
})

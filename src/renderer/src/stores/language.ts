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

  // Lowercased lookup-key → canonical name, for auto-casing typed identifiers.
  const canonicalByKey = computed(() => {
    const map = new Map<string, string>()
    for (const item of vocabulary.value) {
      for (const key of item.lookupKeys) map.set(key, item.name)
    }
    return map
  })

  function canonicalize(word: string): string | undefined {
    return canonicalByKey.value.get(word.toLowerCase())
  }

  return { vocabulary, caseInsensitive, canonicalByKey, canonicalize }
})

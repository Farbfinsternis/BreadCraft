import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * Docs reader state that survives a restart (DOKU sprint, D8 — persist-everything
 * rule, memory: breadcraft-persistence-rule). Remembers the last page you read and
 * the scroll position per page, so re-opening Help drops you back where you were.
 * UI-only state, hence localStorage like the other UI stores (ui.ts/panels.ts).
 */
const STORAGE_KEY = 'breadcraft.docs'

interface PersistedDocs {
  lastPage: string
  scroll: Record<string, number>
}

function loadPersisted(): Partial<PersistedDocs> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<PersistedDocs>) : {}
  } catch {
    return {}
  }
}

export const useDocsStore = defineStore(
  'docs',
  () => {
    const saved = loadPersisted()
    const lastPage = ref<string>(saved.lastPage ?? '')
    const scroll = reactive<Record<string, number>>({ ...saved.scroll })

    function setLastPage(id: string): void {
      lastPage.value = id
    }

    function rememberScroll(pageId: string, top: number): void {
      scroll[pageId] = top
    }

    return { lastPage, scroll, setLastPage, rememberScroll }
  },
  { persist: { key: STORAGE_KEY, paths: ['lastPage', 'scroll'] } }
)

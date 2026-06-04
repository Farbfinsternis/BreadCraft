import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { GraphicsMode, OpenedProject } from '@shared/ipc'
import { DEFAULT_GRAPHICS_MODE } from '@shared/ipc'

const STORAGE_KEY = 'breadcraft.project.ui'

interface PersistedUi {
  debugMode: boolean
}

function loadPersisted(): Partial<PersistedUi> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<PersistedUi>) : {}
  } catch {
    return {}
  }
}

export interface OpenTab {
  rel: string
  name: string
}

/**
 * Project state backed by real files on disk. The .bread + crumb contents are
 * the source of truth (loaded via IPC); this store mirrors the open project,
 * tracks which files are open/active and which have unsaved edits. Only UI
 * prefs (debug toggle) are persisted to localStorage — file content lives on
 * disk, so it must NOT be duplicated here.
 */
export const useProjectStore = defineStore('project', () => {
  const saved = loadPersisted()

  const dir = ref<string | null>(null)
  const projectName = ref('')
  const entry = ref('')
  const temporary = ref(false)
  // Project-wide graphics mode (IDE.md §2.1); the editors read it for pixel
  // aspect / palette layout, the asset IO for hi-res vs MC packing (M1.T5).
  const graphicsMode = ref<GraphicsMode>(DEFAULT_GRAPHICS_MODE)

  // rel → current (possibly edited) content of each open file.
  const contents = reactive<Record<string, string>>({})
  // rel paths currently shown as tabs (in order).
  const openFiles = ref<string[]>([])
  const activeRel = ref<string>('')
  // rel paths with unsaved edits.
  const dirty = reactive<Record<string, boolean>>({})

  const debugMode = ref(saved.debugMode ?? true)

  const tabs = computed<OpenTab[]>(() =>
    openFiles.value.map((rel) => ({ rel, name: rel }))
  )

  const activeContent = computed({
    get: () => contents[activeRel.value] ?? '',
    set: (value: string) => {
      if (contents[activeRel.value] === value) return
      contents[activeRel.value] = value
      dirty[activeRel.value] = true
    }
  })

  function load(project: OpenedProject): void {
    dir.value = project.dir
    projectName.value = project.name
    entry.value = project.entry
    temporary.value = project.temporary
    graphicsMode.value = project.graphicsMode
    for (const key of Object.keys(contents)) delete contents[key]
    for (const key of Object.keys(dirty)) delete dirty[key]
    for (const f of project.files) contents[f.rel] = f.content
    openFiles.value = project.files.map((f) => f.rel)
    activeRel.value = project.entry || openFiles.value[0] || ''

    // Load the project's disk assets into their editors (ASSET_IO.md §4). Lazy
    // store access avoids an import cycle; the editors hold no cross-project state.
    void loadProjectAssets(project)
  }

  /** Pull the project's palette + charset + tilemap assets from disk into their stores. */
  async function loadProjectAssets(project: OpenedProject): Promise<void> {
    const { usePaletteStore } = await import('./palette')
    const { useCharsetStore } = await import('./charset')
    const { useTilemapStore } = await import('./tilemap')
    const palette = usePaletteStore()
    const charset = useCharsetStore()
    const tilemap = useTilemapStore()
    await palette.loadForProject(project.dir, project.assets.palette)
    await charset.loadForProject(project.dir, project.assets.charsets[0] ?? null)
    await tilemap.loadForProject(project.dir, project.assets.tilemaps[0] ?? null)
  }

  function setActiveTab(rel: string): void {
    if (!openFiles.value.includes(rel)) openFiles.value.push(rel)
    activeRel.value = rel
  }

  function addFile(rel: string, content: string): void {
    contents[rel] = content
    if (!openFiles.value.includes(rel)) openFiles.value.push(rel)
    activeRel.value = rel
  }

  async function saveActive(): Promise<void> {
    const rel = activeRel.value
    if (!dir.value || !rel || !dirty[rel]) return
    await window.breadcraft.project.saveFile(dir.value, rel, contents[rel] ?? '')
    dirty[rel] = false
  }

  function toggleDebug(): void {
    debugMode.value = !debugMode.value
  }

  return {
    dir,
    projectName,
    entry,
    temporary,
    graphicsMode,
    contents,
    openFiles,
    activeRel,
    dirty,
    debugMode,
    tabs,
    activeContent,
    load,
    setActiveTab,
    addFile,
    saveActive,
    toggleDebug
  }
}, { persist: { key: STORAGE_KEY, paths: ['debugMode'] } })

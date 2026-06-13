import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BreadAssets, GraphicsMode, OpenedProject } from '@shared/ipc'
import { DEFAULT_GRAPHICS_MODE } from '@shared/ipc'

/** Asset kinds the explorer can list/open/create (P2.T0). */
export type AssetEditorKind = 'sprite' | 'charset' | 'tilemap' | 'palette'

const EMPTY_MANIFEST: BreadAssets = { palette: null, charsets: [], tilemaps: [], sprites: [] }

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

  // The project's asset manifest (P2.T0) — kept reactive so the explorer's asset
  // list updates when a new asset is created. Mirrors the .bread `assets` block.
  const assets = reactive<BreadAssets>({ ...EMPTY_MANIFEST })
  // Bumped whenever a file is created/saved-as so the explorer re-reads the tree.
  const treeVersion = ref(0)
  // Which asset rel is currently open in each editor kind (for the explorer's
  // active marker). '' = none / the default main.* not yet listed.
  const activeAsset = reactive<Record<AssetEditorKind, string>>({
    sprite: '',
    charset: '',
    tilemap: '',
    palette: ''
  })

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

    // Mirror the asset manifest into the reactive store (the explorer reads this).
    Object.assign(assets, EMPTY_MANIFEST, project.assets)
    activeAsset.sprite = project.assets.sprites[0] ?? ''
    activeAsset.charset = project.assets.charsets[0] ?? ''
    activeAsset.tilemap = project.assets.tilemaps[0] ?? ''
    activeAsset.palette = project.assets.palette ?? ''

    // Load the project's disk assets into their editors (ASSET_IO.md §4). Lazy
    // store access avoids an import cycle; the editors hold no cross-project state.
    void loadProjectAssets(project)
  }

  /** Re-read the asset manifest from disk into the reactive store (after create). */
  async function refreshAssets(): Promise<void> {
    if (!dir.value) return
    const fresh = await window.breadcraft.assets.list(dir.value)
    Object.assign(assets, EMPTY_MANIFEST, fresh)
    treeVersion.value++ // signal the explorer to re-read the file tree
  }

  /** The asset list for one kind (the explorer iterates these). */
  function assetsOf(kind: AssetEditorKind): string[] {
    if (kind === 'sprite') return assets.sprites
    if (kind === 'charset') return assets.charsets
    if (kind === 'tilemap') return assets.tilemaps
    return assets.palette ? [assets.palette] : []
  }

  /**
   * Open an existing asset in its editor (P2.T0): switch the matching store to that
   * rel (saving any pending edit first), mark it active. The caller routes the view.
   */
  async function openAsset(kind: AssetEditorKind, rel: string): Promise<void> {
    if (!dir.value) return
    const store = await assetStore(kind)
    await store.switchAsset(dir.value, rel)
    activeAsset[kind] = rel
  }

  /**
   * Create a NEW empty asset under `rel` and open it (P2.T0). Writing it registers
   * it in the .bread manifest (writeAsset appends), so the explorer + the build see
   * it; then we refresh the reactive list and switch the editor to it.
   */
  async function createAsset(kind: AssetEditorKind, rel: string): Promise<void> {
    if (!dir.value) return
    const store = await assetStore(kind)
    await store.createBlank(dir.value, rel)
    await refreshAssets()
    activeAsset[kind] = rel
  }

  /** Lazy-load the asset store for a kind (avoids an import cycle). */
  async function assetStore(kind: AssetEditorKind): Promise<{
    switchAsset(dir: string, rel: string): Promise<void>
    createBlank(dir: string, rel: string): Promise<void>
    saveTo(dir: string, rel: string): Promise<void>
    currentRel(): string
  }> {
    if (kind === 'sprite') return (await import('./sprite')).useSpriteStore()
    if (kind === 'charset') return (await import('./charset')).useCharsetStore()
    if (kind === 'tilemap') return (await import('./tilemap')).useTilemapStore()
    return (await import('./palette')).usePaletteStore()
  }

  /**
   * "Save as…" flow for an editor (P2.T0b): open the file dialog (folder + name in the
   * project, the editor's fixed `ext`), then write the CURRENT editor content to the
   * chosen rel and bind the editor to it. Returns the new rel, or null if cancelled.
   */
  async function saveAssetAs(kind: AssetEditorKind, ext: string, title: string): Promise<string | null> {
    if (!dir.value) return null
    const { useUiStore } = await import('./ui')
    const ui = useUiStore()
    const store = await assetStore(kind)
    const rel = await ui.askSavePath({ title, ext, initialRel: store.currentRel() })
    if (!rel) return null
    await store.saveTo(dir.value, rel)
    await refreshAssets()
    activeAsset[kind] = rel
    return rel
  }

  /** Pull the project's palette + charset + tilemap + sprite assets into their stores. */
  async function loadProjectAssets(project: OpenedProject): Promise<void> {
    const { usePaletteStore } = await import('./palette')
    const { useCharsetStore } = await import('./charset')
    const { useTilemapStore } = await import('./tilemap')
    const { useSpriteStore } = await import('./sprite')
    const palette = usePaletteStore()
    const charset = useCharsetStore()
    const tilemap = useTilemapStore()
    const sprite = useSpriteStore()
    await palette.loadForProject(project.dir, project.assets.palette)
    await charset.loadForProject(project.dir, project.assets.charsets[0] ?? null)
    await tilemap.loadForProject(project.dir, project.assets.tilemaps[0] ?? null)
    await sprite.loadForProject(project.dir, project.assets.sprites[0] ?? null)
  }

  function setActiveTab(rel: string): void {
    if (!openFiles.value.includes(rel)) openFiles.value.push(rel)
    activeRel.value = rel
  }

  /**
   * Open a crumb from the file tree as the active code tab (Befund 7). If its
   * content isn't already loaded — a `.crumb` that lives on disk but isn't in
   * `bread.crumbs` (copied in, made with the OS or another tool) — READ it from
   * disk FIRST. Otherwise the editor would show an empty buffer and the next
   * Ctrl+S would write that emptiness back over the real file (data loss).
   *
   * Opening is NOT saving: the `.bread` manifest is deliberately left untouched
   * here (N12 — manifest adoption belongs to the filesystem-as-truth work, not
   * EISEN). A file that vanished between tree-read and click reads as null; we
   * throw rather than open an empty, savable tab over a path we can't read.
   */
  async function openCrumb(rel: string): Promise<void> {
    if (contents[rel] === undefined) {
      if (!dir.value) return
      const text = await window.breadcraft.assets.read(dir.value, rel)
      if (text === null) throw new Error(`Datei nicht gefunden: ${rel}`)
      contents[rel] = text
      dirty[rel] = false
    }
    setActiveTab(rel)
  }

  function addFile(rel: string, content: string): void {
    contents[rel] = content
    if (!openFiles.value.includes(rel)) openFiles.value.push(rel)
    activeRel.value = rel
    treeVersion.value++ // new crumb → refresh the explorer tree
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
    assets,
    activeAsset,
    treeVersion,
    tabs,
    activeContent,
    load,
    setActiveTab,
    openCrumb,
    addFile,
    saveActive,
    toggleDebug,
    refreshAssets,
    assetsOf,
    openAsset,
    createAsset,
    saveAssetAs
  }
}, { persist: { key: STORAGE_KEY, paths: ['debugMode'] } })

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { EDITOR_ROUTE_NAMES } from '@renderer/router'
import { useProjectStore } from '@renderer/stores/project'
import { useSettingsStore } from '@renderer/stores/settings'
import { useOutputStore } from '@renderer/stores/output'
import { useUiStore } from '@renderer/stores/ui'
import { buildNewProjectRequest } from '@renderer/components/newProjectRequest'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const project = useProjectStore()
const settings = useSettingsStore()
const output = useOutputStore()
const ui = useUiStore()

const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)

// Close the editor dropdown on any click outside it. The listener is only active
// while the menu is open. The toggle button uses @click.stop, so opening doesn't
// immediately trip this; a click inside the menu is ignored via contains().
function onDocClick(ev: MouseEvent): void {
  if (menuEl.value && !menuEl.value.contains(ev.target as Node)) menuOpen.value = false
}
watch(menuOpen, (open) => {
  if (open) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

/**
 * Build the active .crumb file, optionally running it in VICE afterwards. The plain
 * "Build" button passes runAfterBuild=false (just produce the .prg, M4.T2); "Build &
 * Run" passes true. Both build the ACTIVE file (Befund 9 — building the entry crumb
 * regardless of the active tab — is a separate, later task); the Build button's
 * tooltip says so honestly.
 */
async function runBuild(runAfterBuild: boolean): Promise<void> {
  if (output.busy) return
  const rel = project.activeRel
  if (!project.dir || !rel) {
    output.clear()
    output.append({ level: 'error', text: t('build.noActiveFile') })
    if (ui.collapsed.console) ui.expand('console')
    return
  }
  if (!rel.toLowerCase().endsWith('.crumb')) {
    output.clear()
    output.append({ level: 'error', text: t('build.notCrumbFile', { rel }) })
    if (ui.collapsed.console) ui.expand('console')
    return
  }

  output.busy = true
  output.clear()
  if (ui.collapsed.console) ui.expand('console')
  output.append({ level: 'info', text: t(runAfterBuild ? 'build.start' : 'build.startBuild', { rel }) })
  try {
    await project.saveActive() // build from the on-disk truth
    const source = project.contents[rel] ?? ''
    const result = await window.breadcraft.build.run(source, project.dir, runAfterBuild)
    output.appendMany(result.log)
    output.ram = result.ram ?? null // feed the RAM health-bar (STAHL S1c)
    output.perf = result.perf ?? null // feed the PERF health-bar (estimated cost)
    if (result.needsVicePath) {
      output.append({ level: 'info', text: t('build.viceHint') })
      settings.openModal()
    }
  } catch (e) {
    output.append({ level: 'error', text: String((e as Error).message ?? e) })
  } finally {
    output.busy = false
  }
}

/** Toolbar "Build": produce the .prg from the active file, no VICE launch. */
function build(): Promise<void> {
  return runBuild(false)
}

/** Toolbar "Build & Run": build the active file and launch it in VICE if configured. */
function buildAndRun(): Promise<void> {
  return runBuild(true)
}

const editors = computed(() => [
  { label: t('toolbar.editor.palette'), route: 'palette' },
  { label: t('toolbar.editor.tileset'), route: 'tileset' },
  { label: t('toolbar.editor.tilemap'), route: 'tilemap' },
  { label: t('toolbar.editor.sprite'), route: 'sprite' },
  { label: t('toolbar.editor.sound'), route: 'sound' }
])

// Zen mode (full-width editor) only makes sense in the graphics editors — not in
// the code view, which needs the outliner/console. Show the toggle only there.
const isEditorRoute = computed(() =>
  (EDITOR_ROUTE_NAMES as readonly string[]).includes(String(route.name))
)

function openEditor(name: string): void {
  if (!project.dir) return // editors require an open project (ASSET_DOCUMENTS.md §1)
  router.push({ name })
  menuOpen.value = false
}

async function newProject(): Promise<void> {
  const choice = await ui.askNewProject(buildNewProjectRequest(t))
  if (!choice) return
  const opened = await window.breadcraft.project.create(
    choice.name,
    choice.graphicsMode,
    choice.withBoilerplate,
    choice.region
  )
  project.load(opened)
  if (router.currentRoute.value.name !== 'code') router.push({ name: 'code' })
}

async function newFile(): Promise<void> {
  // No project open → spin up a temporary project (a FULL project under
  // <workspace>/temp, with main.crumb) and drop into it: "new file → go", no name
  // prompt. A temp project is a normal project at a temp location that the IDE
  // expires unless converted (memory breadcraft-ide-architecture).
  if (!project.dir) {
    try {
      const opened = await window.breadcraft.project.createTemp()
      project.load(opened)
      if (router.currentRoute.value.name !== 'code') router.push({ name: 'code' })
    } catch (e) {
      await ui.notify({ title: t('dialog.error'), message: String((e as Error).message ?? e) })
    }
    return
  }
  // A project is open → add a named file to it.
  const name = await ui.ask({ title: t('toolbar.newFile'), label: t('toolbar.prompt.newFileName') })
  if (!name) return
  try {
    const file = await window.breadcraft.project.createFile(project.dir, name)
    project.addFile(file.rel, file.content)
    if (router.currentRoute.value.name !== 'code') router.push({ name: 'code' })
  } catch (e) {
    await ui.notify({ title: t('dialog.error'), message: String((e as Error).message ?? e) })
  }
}

async function openProject(): Promise<void> {
  const opened = await window.breadcraft.project.openDialog()
  if (opened) {
    project.load(opened)
    if (router.currentRoute.value.name !== 'code') router.push({ name: 'code' })
  }
}
</script>

<template>
  <header class="tb">
    <div class="tb-actions">
      <!-- group: file / project — icon only -->
      <div class="tb-group">
        <button class="tbtn tbtn-icon" :title="t('toolbar.newProject')" :aria-label="t('toolbar.newProject')" @click="newProject">
          <svg class="ico" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v4M10 13h4" /></svg>
        </button>
        <button class="tbtn tbtn-icon" :title="t('toolbar.newFile')" :aria-label="t('toolbar.newFile')" @click="newFile">
          <svg class="ico" viewBox="0 0 24 24"><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M12 11v6M9 14h6" /></svg>
        </button>
        <button class="tbtn tbtn-icon" :title="t('toolbar.openProject')" :aria-label="t('toolbar.openProject')" @click="openProject">
          <svg class="ico" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        </button>
        <button class="tbtn tbtn-icon" :title="t('toolbar.closeProject')" :aria-label="t('toolbar.closeProject')">
          <svg class="ico" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <span class="tb-divider" />

      <!-- group: build / run — large labelled -->
      <div class="tb-group">
        <button
          class="tbtn tbtn-lg tbtn-toggle"
          :class="{ 'is-on': project.debugMode }"
          :title="t('toolbar.debugToggle')"
          :aria-pressed="project.debugMode"
          @click="project.toggleDebug()"
        >
          <svg class="ico" viewBox="0 0 24 24"><path d="m8 2 1.5 1.5M16 2l-1.5 1.5" /><path d="M12 20a6 6 0 0 0 6-6v-3a6 6 0 0 0-12 0v3a6 6 0 0 0 6 6Z" /><path d="M12 8v12M3 11h3M18 11h3M4 7l2 1M20 7l-2 1M4 16l2-1M20 16l-2-1" /></svg>
          <span>{{ t('toolbar.debug') }}</span>
          <span class="led" />
        </button>
        <button
          class="tbtn tbtn-lg tbtn-ghost"
          :title="t('toolbar.buildHint')"
          :disabled="output.busy"
          @click="build"
        >
          <svg class="ico" viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="m3 7 9 5 9-5M12 12v10" /></svg>
          <span>{{ t('toolbar.build') }}</span>
        </button>
        <button
          class="tbtn tbtn-lg tbtn-primary"
          :title="t('toolbar.buildAndRun')"
          :disabled="output.busy"
          @click="buildAndRun"
        >
          <svg class="ico" viewBox="0 0 24 24"><path d="m6 4 14 8-14 8z" /></svg>
          <span>{{ output.busy ? t('toolbar.building') : t('toolbar.buildAndRun') }}</span>
        </button>
      </div>

      <span class="tb-divider" />

      <!-- group: editors + help -->
      <div class="tb-group">
        <div ref="menuEl" class="tb-menu">
          <button
            class="tbtn tbtn-icon"
            id="editorMenuBtn"
            :title="t('toolbar.openEditor')"
            :aria-label="t('toolbar.openEditor')"
            :aria-expanded="menuOpen"
            @click.stop="menuOpen = !menuOpen"
          >
            <svg class="ico" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></svg>
            <svg class="ico-caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div v-if="menuOpen" class="dropdown" role="menu">
            <div class="dropdown-label bc-label">{{ t('toolbar.openEditor') }}</div>
            <button
              v-for="e in editors"
              :key="e.route"
              class="dropdown-item"
              role="menuitem"
              :disabled="!project.dir"
              :title="!project.dir ? t('toolbar.editorNeedsProject') : ''"
              @click="openEditor(e.route)"
            >
              <svg class="ico-sm" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
              <span>{{ e.label }}</span>
            </button>
          </div>
        </div>
        <button
          v-if="isEditorRoute"
          class="tbtn tbtn-icon tbtn-toggle"
          :class="{ 'is-on': ui.zen }"
          :title="ui.zen ? t('toolbar.restoreView') : t('toolbar.maximizeView')"
          :aria-label="ui.zen ? t('toolbar.restoreView') : t('toolbar.maximizeView')"
          :aria-pressed="ui.zen"
          @click="ui.toggleZen()"
        >
          <svg v-if="!ui.zen" class="ico" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
          <svg v-else class="ico" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
        </button>
        <button class="tbtn tbtn-icon" :title="t('toolbar.help')" :aria-label="t('toolbar.help')">
          <svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.3 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.7 2.4-2.7 4" /><path d="M12 17h.01" /></svg>
        </button>
      </div>

      <span class="tb-divider" />

      <!-- group: settings -->
      <div class="tb-group">
        <button class="tbtn tbtn-icon" :title="t('toolbar.projectSettings')" :aria-label="t('toolbar.projectSettings')">
          <svg class="ico" viewBox="0 0 24 24"><path d="M10.5 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3.5" /><circle cx="18" cy="18" r="2.5" /><path d="M18 14v1.5M18 20.5V22M21.5 16l-1.3.75M15.8 19.25 14.5 20M21.5 20l-1.3-.75M15.8 16.75 14.5 16" /></svg>
        </button>
        <button class="tbtn tbtn-icon" :title="t('toolbar.globalSettings')" :aria-label="t('toolbar.globalSettings')" @click="settings.openModal()">
          <svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </div>
    </div>
  </header>
</template>

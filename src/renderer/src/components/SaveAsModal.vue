<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@renderer/stores/ui'
import { useProjectStore } from '@renderer/stores/project'
import type { TreeNode } from '@shared/ipc'

/**
 * The in-app "Save as…" file dialog (P2.T0b), scoped to the project folder. The user
 * picks a target FOLDER (the project's real sub-folders) + a file NAME; the editor
 * fixes the extension (ui.saveAs.ext). Returns a project-relative path. Driven by
 * ui.saveAs, mounted once in App.vue — same overlay pattern as PromptModal. Bound to
 * the project folder only (no assets outside the project).
 */

const { t } = useI18n()
const ui = useUiStore()
const project = useProjectStore()

// Flattened folder list (root + every sub-folder), each with its depth for indent.
interface FolderRow {
  rel: string // '' = project root
  label: string
  depth: number
}
const folders = ref<FolderRow[]>([])
const selectedFolder = ref('') // '' = root
const fileName = ref('')
const nameRef = ref<HTMLInputElement | null>(null)

/** Walk the project tree into a flat folder list (dirs only). */
function flattenFolders(nodes: TreeNode[], depth: number, out: FolderRow[]): void {
  for (const n of nodes) {
    if (n.kind !== 'dir') continue
    out.push({ rel: n.rel, label: n.name, depth })
    if (n.children) flattenFolders(n.children, depth + 1, out)
  }
}

async function refreshFolders(): Promise<void> {
  if (!project.dir) {
    folders.value = [{ rel: '', label: project.projectName || '/', depth: 0 }]
    return
  }
  const tree = await window.breadcraft.project.tree(project.dir)
  const out: FolderRow[] = [{ rel: '', label: project.projectName || '/', depth: 0 }]
  flattenFolders(tree, 1, out)
  folders.value = out
}

// When the dialog opens, load the folder tree + seed name/folder from initialRel.
watch(
  () => ui.saveAs,
  async (req) => {
    if (!req) return
    await refreshFolders()
    // Pre-fill from an existing path (re-save) so the user lands on the same spot.
    if (req.initialRel) {
      const norm = req.initialRel.replace(/\\/g, '/')
      const slash = norm.lastIndexOf('/')
      selectedFolder.value = slash >= 0 ? norm.slice(0, slash) : ''
      const base = slash >= 0 ? norm.slice(slash + 1) : norm
      fileName.value = base.replace(/\.[^.]+$/, '')
    } else {
      selectedFolder.value = ''
      fileName.value = ''
    }
    await nextTick()
    nameRef.value?.focus()
    nameRef.value?.select()
  }
)

const ext = computed(() => ui.saveAs?.ext ?? '')

/** The resulting project-relative path preview (folder/name.ext). */
const preview = computed(() => {
  const stem = cleanStem(fileName.value)
  if (!stem) return ''
  const base = `${stem}${ext.value}`
  return selectedFolder.value ? `${selectedFolder.value}/${base}` : base
})

/** Sanitise the typed name to a filesystem-safe stem (no extension, no slashes). */
function cleanStem(raw: string): string {
  return raw
    .trim()
    .replace(/\.[a-z0-9]+$/i, '') // drop any typed extension
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

async function newFolder(): Promise<void> {
  if (!project.dir) return
  const name = await ui.ask({ title: t('saveas.newFolder'), label: t('saveas.newFolderName') })
  if (!name) return
  const safe = name.trim().replace(/\\/g, '/').replace(/[^a-z0-9_/-]+/gi, '-').replace(/^\/+|\/+$/g, '')
  if (!safe) return
  const rel = selectedFolder.value ? `${selectedFolder.value}/${safe}` : safe
  try {
    const created = await window.breadcraft.project.createFolder(project.dir, rel)
    await refreshFolders()
    selectedFolder.value = created
  } catch (e) {
    await ui.notify({ title: t('dialog.error'), message: String((e as Error).message ?? e) })
  }
}

function confirm(): void {
  const rel = preview.value
  if (!rel) return
  ui.resolveSaveAs(rel)
}

function cancel(): void {
  ui.cancelSaveAs()
}
</script>

<template>
  <div v-if="ui.saveAs" class="sa-scrim" @click.self="cancel" @keydown.esc="cancel">
    <div class="sa-card" role="dialog" aria-modal="true" :aria-label="ui.saveAs.title">
      <span class="bc-label sa-title">{{ ui.saveAs.title }}</span>

      <span class="bc-label sa-field-label">{{ t('saveas.folder') }}</span>
      <div class="sa-folders">
        <button
          v-for="f in folders"
          :key="f.rel"
          class="sa-folder"
          :class="{ 'is-sel': selectedFolder === f.rel }"
          :style="{ paddingLeft: `${8 + f.depth * 16}px` }"
          @click="selectedFolder = f.rel"
        >
          <svg class="ico-sm" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          <span>{{ f.label }}</span>
        </button>
      </div>
      <button class="sa-newfolder" @click="newFolder">+ {{ t('saveas.newFolder') }}</button>

      <span class="bc-label sa-field-label">{{ t('saveas.fileName') }}</span>
      <div class="sa-name-row">
        <input
          ref="nameRef"
          v-model="fileName"
          class="sa-input"
          type="text"
          spellcheck="false"
          :placeholder="t('saveas.namePlaceholder')"
          @keydown.enter="confirm"
          @keydown.esc="cancel"
        />
        <span class="sa-ext">{{ ext }}</span>
      </div>

      <p class="sa-preview" :class="{ 'is-empty': !preview }">
        {{ preview || t('saveas.previewEmpty') }}
      </p>

      <footer class="sa-actions">
        <button class="tbtn" @click="cancel">{{ t('dialog.cancel') }}</button>
        <button class="tbtn tbtn-primary" :disabled="!preview" @click="confirm">
          {{ t('saveas.save') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.sa-scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 15, 0.7);
}
.sa-card {
  display: flex;
  flex-direction: column;
  width: 480px;
  max-width: calc(100vw - 48px);
  padding: var(--bc-space-6);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
}
.sa-title {
  display: block;
}
.sa-field-label {
  display: block;
  margin: var(--bc-space-4) 0 var(--bc-space-2);
}
.sa-folders {
  max-height: 200px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  padding: 4px;
}
.sa-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 8px;
  font: 500 12.5px/1 var(--bc-font-sans);
  color: var(--bc-text-300);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--bc-radius-sm);
  cursor: pointer;
  text-align: left;
}
.sa-folder:hover {
  color: var(--bc-text-100);
}
.sa-folder.is-sel {
  color: var(--bc-text-100);
  border-color: var(--bc-arc-400);
  background: rgba(94, 196, 255, 0.08);
}
.sa-folder .ico-sm {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--bc-copper-300);
  stroke-width: 1.6;
}
.sa-newfolder {
  align-self: flex-start;
  margin-top: 6px;
  padding: 4px 10px;
  font: 600 11px/1 var(--bc-font-sans);
  color: var(--bc-copper-300);
  background: transparent;
  border: 1px dashed var(--bc-border-copper);
  border-radius: var(--bc-radius-pill);
  cursor: pointer;
}
.sa-newfolder:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-glow-copper);
}
.sa-name-row {
  display: flex;
  align-items: stretch;
  gap: 0;
}
.sa-input {
  flex: 1;
  height: 38px;
  padding: 0 var(--bc-space-3);
  font: 400 14px/1 var(--bc-font-mono);
  color: var(--bc-text-100);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md) 0 0 var(--bc-radius-md);
}
.sa-input:focus {
  outline: none;
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.sa-ext {
  display: flex;
  align-items: center;
  padding: 0 var(--bc-space-3);
  font: 500 13px/1 var(--bc-font-mono);
  color: var(--bc-text-400);
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--bc-border);
  border-left: none;
  border-radius: 0 var(--bc-radius-md) var(--bc-radius-md) 0;
}
.sa-preview {
  margin: var(--bc-space-3) 0 0;
  font: 500 12px/1.3 var(--bc-font-mono);
  color: var(--bc-arc-300);
  word-break: break-all;
}
.sa-preview.is-empty {
  color: var(--bc-text-400);
}
.sa-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--bc-space-2);
  margin-top: var(--bc-space-6);
}
</style>

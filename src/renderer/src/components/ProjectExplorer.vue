<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useUiStore } from '@renderer/stores/ui'
import { useProjectStore, type AssetEditorKind } from '@renderer/stores/project'
import PanelResizer from '@renderer/components/PanelResizer.vue'
import ExplorerNode from '@renderer/components/ExplorerNode.vue'
import type { TreeNode } from '@shared/ipc'

/**
 * Project explorer (P2.T0b) — a real recursive file tree mirroring the project
 * folder on disk (PROJECT_EXPLORER.md). Clicking a file opens it in the editor that
 * matches its extension; the asset stores load it by its full project-relative path.
 * The tree re-reads whenever a file is created / saved-as (project.treeVersion).
 */

const { t } = useI18n()
const ui = useUiStore()
const project = useProjectStore()
const router = useRouter()

const tree = ref<TreeNode[]>([])

async function refreshTree(): Promise<void> {
  if (!project.dir) {
    tree.value = []
    return
  }
  tree.value = await window.breadcraft.project.tree(project.dir)
}

// Re-read the tree on project open and after any create/save-as (treeVersion bump).
watch(
  () => [project.dir, project.treeVersion] as const,
  () => {
    void refreshTree()
  },
  { immediate: true }
)

/** Extension → which editor opens it. `.crumb` is the code view (not an asset). */
const EXT_ROUTE: Record<string, { route: string; kind?: AssetEditorKind }> = {
  crumb: { route: 'code' },
  sprite: { route: 'sprite', kind: 'sprite' },
  petscii: { route: 'tileset', kind: 'charset' },
  tilemap: { route: 'tilemap', kind: 'tilemap' },
  palette: { route: 'palette', kind: 'palette' }
}

function extOf(rel: string): string {
  const dot = rel.lastIndexOf('.')
  return dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ''
}

/** Open a file node: route to its editor, loading the asset by its full rel. */
async function openNode(node: TreeNode): Promise<void> {
  const target = EXT_ROUTE[extOf(node.rel)]
  if (!target) {
    await ui.notify({ title: t('explorer.unknownType'), message: node.rel })
    return
  }
  try {
    if (target.kind) {
      await project.openAsset(target.kind, node.rel)
    } else {
      // a crumb → make it the active code tab
      project.setActiveTab(node.rel)
    }
    if (router.currentRoute.value.name !== target.route) await router.push({ name: target.route })
  } catch (e) {
    await ui.notify({ title: t('dialog.error'), message: String((e as Error).message ?? e) })
  }
}

async function newFile(): Promise<void> {
  if (!project.dir) return
  const name = await ui.ask({ title: t('explorer.newFile'), label: t('explorer.prompt.newFileName') })
  if (!name) return
  try {
    const file = await window.breadcraft.project.createFile(project.dir, name)
    project.addFile(file.rel, file.content)
    if (router.currentRoute.value.name !== 'code') await router.push({ name: 'code' })
  } catch (e) {
    await ui.notify({ title: t('dialog.error'), message: String((e as Error).message ?? e) })
  }
}
</script>

<template>
  <section
    class="panel"
    id="panel-explorer"
    data-side="left"
    :style="{ flex: `0 0 ${ui.sizes.explorer}px`, width: `${ui.sizes.explorer}px` }"
  >
    <div class="panel-head">
      <span class="bc-label">{{ t('explorer.title') }}</span>
      <div class="panel-head-actions">
        <button class="collapse-btn" :title="t('explorer.newFile')" @click="newFile">
          <svg class="ico-sm" viewBox="0 0 24 24"><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M12 11v6M9 14h6" /></svg>
        </button>
        <button class="collapse-btn" :title="t('explorer.collapse')" @click="ui.collapse('explorer')">
          <svg class="ico-sm" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        </button>
      </div>
    </div>
    <div class="panel-body explorer">
      <div v-if="project.dir" class="tree">
        <div class="tree-row tree-folder open">
          <svg class="ico-sm tw" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <svg class="ico-sm" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          <span>{{ project.projectName }}</span>
          <span v-if="project.temporary" class="temp-badge">temp</span>
        </div>
        <div class="tree-children">
          <ExplorerNode
            v-for="node in tree"
            :key="node.rel"
            :node="node"
            :depth="1"
            :active-rel="project.activeRel"
            @open="openNode"
          />
        </div>
      </div>
      <div v-else class="explorer-empty bc-body-sm">{{ t('explorer.empty') }}</div>
    </div>
    <PanelResizer panel="explorer" dir="e" />
  </section>
</template>

<style scoped>
.panel-head-actions {
  display: flex;
  gap: 2px;
}
.temp-badge {
  margin-left: auto;
  font: 600 9px/1 var(--bc-font-sans);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--bc-filament);
  border: 1px solid rgba(255, 138, 61, 0.4);
  border-radius: var(--bc-radius-pill);
  padding: 2px 6px;
}
.explorer-empty {
  padding: var(--bc-space-4);
  color: var(--bc-text-400);
}
</style>

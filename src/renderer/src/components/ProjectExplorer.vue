<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@renderer/stores/ui'
import { useProjectStore } from '@renderer/stores/project'
import PanelResizer from '@renderer/components/PanelResizer.vue'

const { t } = useI18n()
const ui = useUiStore()
const project = useProjectStore()

async function newFile(): Promise<void> {
  if (!project.dir) return
  const name = window.prompt(t('explorer.prompt.newFileName'))
  if (!name) return
  try {
    const file = await window.breadcraft.project.createFile(project.dir, name)
    project.addFile(file.rel, file.content)
  } catch (e) {
    window.alert(String((e as Error).message ?? e))
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
          <div
            v-for="rel in project.openFiles"
            :key="rel"
            class="tree-row tree-file"
            :class="{ 'is-active': rel === project.activeRel }"
            style="--d: 1"
            @click="project.setActiveTab(rel)"
          >
            <svg class="ico-sm" viewBox="0 0 24 24"><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /></svg>
            <span>{{ rel }}</span>
            <span v-if="project.dirty[rel]" class="dirty-dot">●</span>
          </div>
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
.dirty-dot {
  margin-left: auto;
  color: var(--bc-filament);
  font-size: 10px;
}
.explorer-empty {
  padding: var(--bc-space-4);
  color: var(--bc-text-400);
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useProjectStore } from '@renderer/stores/project'
import MonacoEditor from '@renderer/components/MonacoEditor.vue'

const project = useProjectStore()

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void project.saveActive()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="code-view">
    <div class="tabs">
      <div
        v-for="tab in project.tabs"
        :key="tab.rel"
        class="tab"
        :class="{ 'is-active': tab.rel === project.activeRel }"
        @click="project.setActiveTab(tab.rel)"
      >
        <svg class="ico-sm" viewBox="0 0 24 24"><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /></svg>
        <span>{{ tab.name }}</span>
        <span v-if="project.dirty[tab.rel]" class="tab-dirty">●</span>
      </div>
    </div>
    <div class="panel-body editor">
      <MonacoEditor v-model="project.activeContent" />
    </div>
  </div>
</template>

<style scoped>
.code-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.code-view .panel-body {
  flex: 1 1 auto;
}
.tab-dirty {
  color: var(--bc-filament);
  font-size: 11px;
  line-height: 1;
}
</style>

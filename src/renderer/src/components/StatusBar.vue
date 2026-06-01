<script setup lang="ts">
import { useProjectStore } from '@renderer/stores/project'

const project = useProjectStore()
</script>

<template>
  <footer class="statusbar">
    <span class="sb-item">{{ project.projectName || '—' }}</span>
    <span class="sb-spacer" />
    <span class="sb-item">{{ project.activeRel || '—' }}</span>
    <span class="sb-item">BreadCraft · C64 · MULTICOLOR</span>
  </footer>
</template>

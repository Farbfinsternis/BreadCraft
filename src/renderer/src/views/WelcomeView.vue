<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useProjectStore } from '@renderer/stores/project'
import type { RecentProject } from '@shared/ipc'
import logoUrl from '@renderer/assets/breadcraft-logo.png'

const { t } = useI18n()
const router = useRouter()
const project = useProjectStore()
const recents = ref<RecentProject[]>([])

onMounted(async () => {
  recents.value = await window.breadcraft.project.recents()
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

async function openRecent(breadPath: string): Promise<void> {
  const opened = await window.breadcraft.project.open(breadPath)
  project.load(opened)
  router.push({ name: 'code' })
}

async function newProject(): Promise<void> {
  const name = window.prompt(t('welcome.prompt.newProjectName'))
  if (!name) return
  const opened = await window.breadcraft.project.create(name)
  project.load(opened)
  router.push({ name: 'code' })
}

async function openProject(): Promise<void> {
  const opened = await window.breadcraft.project.openDialog()
  if (opened) {
    project.load(opened)
    router.push({ name: 'code' })
  }
}
</script>

<template>
  <div class="welcome">
    <div class="welcome-inner">
      <img class="welcome-logo" :src="logoUrl" alt="BreadCraft" />

      <div class="welcome-actions">
        <button class="tbtn tbtn-lg tbtn-primary" @click="newProject">
          {{ t('welcome.newProject') }}
        </button>
        <button class="tbtn tbtn-lg" @click="openProject">{{ t('welcome.openProject') }}</button>
      </div>

      <div class="recent">
        <span class="bc-label recent-title">{{ t('welcome.recentTitle') }}</span>
        <div v-if="recents.length" class="recent-list">
          <button
            v-for="r in recents"
            :key="r.breadPath"
            class="recent-item"
            @click="openRecent(r.breadPath)"
          >
            <svg class="ico-sm" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            <span class="recent-name">{{ r.name }}</span>
            <span class="recent-date">{{ formatDate(r.openedAt) }}</span>
          </button>
        </div>
        <p v-else class="recent-empty bc-body-sm">{{ t('welcome.recentEmpty') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(30, 45, 77, 0.4), transparent 60%),
    var(--bc-navy-900);
  overflow: auto;
}
.welcome-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 480px;
  max-width: calc(100vw - 64px);
  padding: var(--bc-space-7) 0;
}
.welcome-logo {
  width: 280px;
  height: auto;
  filter: drop-shadow(0 6px 22px rgba(94, 196, 255, 0.25));
}
.welcome-actions {
  display: flex;
  gap: var(--bc-space-3);
  margin: var(--bc-space-7) 0;
}
.recent {
  width: 100%;
}
.recent-title {
  display: block;
  margin-bottom: var(--bc-space-3);
}
.recent-list {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-1);
}
.recent-item {
  display: flex;
  align-items: center;
  gap: var(--bc-space-3);
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: var(--bc-bg-elev-1);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  color: var(--bc-text-200);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.recent-item:hover {
  border-color: var(--bc-arc-400);
  background: var(--bc-bg-elev-2);
  box-shadow: var(--bc-glow-arc);
}
.recent-item .ico-sm {
  color: var(--bc-copper-300);
}
.recent-name {
  font-weight: 500;
}
.recent-date {
  margin-left: auto;
  font: 400 11px/1 var(--bc-font-mono);
  color: var(--bc-text-400);
}
.recent-empty {
  color: var(--bc-text-400);
}
</style>

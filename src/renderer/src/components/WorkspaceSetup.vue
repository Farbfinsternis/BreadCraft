<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@renderer/stores/workspace'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const chosenRoot = ref('')
const busy = ref(false)

onMounted(async () => {
  chosenRoot.value = await workspace.suggestRoot()
})

async function browse(): Promise<void> {
  const picked = await workspace.chooseRoot(chosenRoot.value)
  if (picked) chosenRoot.value = picked
}

async function confirm(): Promise<void> {
  if (!chosenRoot.value || busy.value) return
  busy.value = true
  try {
    await workspace.initWith(chosenRoot.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="setup-scrim">
    <div class="setup-card">
      <span class="bc-label">{{ t('setup.label') }}</span>
      <h2 class="bc-h3 setup-title">{{ t('setup.title') }}</h2>
      <p class="bc-body setup-intro">
        {{ t('setup.intro', { temp: 'temp', projects: 'projects' }) }}
      </p>

      <span class="bc-label setup-field-label">{{ t('setup.fieldLabel') }}</span>
      <div class="setup-path-row">
        <input v-model="chosenRoot" class="setup-input" type="text" spellcheck="false" />
        <button class="tbtn" @click="browse">{{ t('setup.browse') }}</button>
      </div>

      <div class="setup-actions">
        <button
          class="tbtn tbtn-lg tbtn-primary"
          :disabled="!chosenRoot || busy"
          @click="confirm"
        >
          {{ busy ? t('setup.confirming') : t('setup.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 15, 0.7);
}
.setup-card {
  width: 520px;
  max-width: calc(100vw - 48px);
  padding: var(--bc-space-6);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
}
.setup-title {
  margin: var(--bc-space-2) 0 var(--bc-space-3);
}
.setup-intro {
  color: var(--bc-text-300);
  margin: 0 0 var(--bc-space-5);
}
.mono {
  font-family: var(--bc-font-mono);
  font-size: 12px;
  color: var(--bc-arc-200);
  background: rgba(94, 196, 255, 0.06);
  border: 1px solid var(--bc-border-subtle);
  padding: 1px 5px;
  border-radius: var(--bc-radius-sm);
}
.setup-field-label {
  display: block;
  margin-bottom: var(--bc-space-2);
}
.setup-path-row {
  display: flex;
  gap: var(--bc-space-2);
}
.setup-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 36px;
  padding: 0 var(--bc-space-3);
  font: 400 13px/1 var(--bc-font-mono);
  color: var(--bc-text-100);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
}
.setup-input:focus {
  outline: none;
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.setup-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--bc-space-6);
}
</style>

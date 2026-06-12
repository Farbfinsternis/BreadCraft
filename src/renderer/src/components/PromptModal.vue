<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@renderer/stores/ui'

/**
 * The in-app prompt dialog — name entry + messages, replacing the Electron-disabled
 * window.prompt/alert (see stores/ui.ts). Driven entirely by ui.prompt; mounted once
 * in App.vue. Mirrors SettingsModal's overlay (scrim + card, @click.self cancels).
 * Enter confirms, Esc cancels — the familiar dialog gestures.
 */

const { t } = useI18n()
const ui = useUiStore()

const value = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// When a new prompt opens, seed the field and focus it (input kind only).
watch(
  () => ui.prompt,
  async (req) => {
    if (!req) return
    value.value = req.initial ?? ''
    if (req.kind === 'input') {
      await nextTick()
      inputRef.value?.focus()
      inputRef.value?.select()
    }
  }
)

function confirm(): void {
  const req = ui.prompt
  if (!req) return
  if (req.kind === 'message' || req.kind === 'confirm') {
    ui.resolvePrompt('')
    return
  }
  const trimmed = value.value.trim()
  if (!trimmed) {
    ui.cancelPrompt() // empty = cancel (same as the old `if (!name) return`)
    return
  }
  ui.resolvePrompt(trimmed)
}

function cancel(): void {
  ui.cancelPrompt()
}
</script>

<template>
  <div
    v-if="ui.prompt"
    class="prompt-scrim"
    @click.self="cancel"
    @keydown.esc="cancel"
  >
    <div class="prompt-card" role="dialog" aria-modal="true" :aria-label="ui.prompt.title">
      <span class="bc-label prompt-title">{{ ui.prompt.title }}</span>

      <p v-if="ui.prompt.message" class="bc-body prompt-message">{{ ui.prompt.message }}</p>

      <template v-if="ui.prompt.kind === 'input'">
        <span v-if="ui.prompt.label" class="bc-label prompt-field-label">{{ ui.prompt.label }}</span>
        <input
          ref="inputRef"
          v-model="value"
          class="prompt-input"
          type="text"
          spellcheck="false"
          :placeholder="ui.prompt.placeholder ?? ''"
          @keydown.enter="confirm"
          @keydown.esc="cancel"
        />
      </template>

      <footer class="prompt-actions">
        <button v-if="ui.prompt.kind !== 'message'" class="tbtn" @click="cancel">
          {{ t('dialog.cancel') }}
        </button>
        <button class="tbtn tbtn-primary" @click="confirm">
          {{ ui.prompt.kind === 'message' ? t('dialog.ok') : ui.prompt.confirmLabel ?? t('dialog.confirm') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.prompt-scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 15, 0.7);
}
.prompt-card {
  display: flex;
  flex-direction: column;
  width: 440px;
  max-width: calc(100vw - 48px);
  padding: var(--bc-space-6);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
}
.prompt-title {
  display: block;
}
.prompt-message {
  margin: var(--bc-space-3) 0 0;
  color: var(--bc-text-300);
}
.prompt-field-label {
  display: block;
  margin: var(--bc-space-4) 0 var(--bc-space-2);
}
.prompt-input {
  height: 38px;
  margin-top: var(--bc-space-3);
  padding: 0 var(--bc-space-3);
  font: 400 14px/1 var(--bc-font-mono);
  color: var(--bc-text-100);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
}
.prompt-input:focus {
  outline: none;
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--bc-space-2);
  margin-top: var(--bc-space-6);
}
</style>

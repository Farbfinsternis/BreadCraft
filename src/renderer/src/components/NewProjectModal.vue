<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@renderer/stores/ui'
import type { ProjectTemplate, Region } from '@shared/ipc'

/**
 * The New-Project dialog: name + starter template + target region + boilerplate toggle.
 * The template is NOT a screen-mode choice — the mode stays a runtime `SetMode` switch,
 * not a project identity (ScreenMode block); the template only decides what the first
 * `main.crumb` (and, for a picture project, the first asset) contain. Driven by
 * ui.newProject; mounted once in App.vue. Mirrors PromptModal's overlay (scrim + card,
 * @click.self cancels; Enter confirms, Esc cancels).
 */

const { t } = useI18n()
const ui = useUiStore()

const name = ref('')
const region = ref<Region>('PAL')
const template = ref<ProjectTemplate>('plain')
const boilerplate = ref(true)
const inputRef = ref<HTMLInputElement | null>(null)

// On open: seed fields, default region/template to the first listed, focus name.
watch(
  () => ui.newProject,
  async (req) => {
    if (!req) return
    name.value = ''
    boilerplate.value = true
    if (req.regions[0]) region.value = req.regions[0].value
    if (req.templates[0]) template.value = req.templates[0].value
    await nextTick()
    inputRef.value?.focus()
  }
)

function confirm(): void {
  const req = ui.newProject
  if (!req) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    ui.cancelNewProject() // empty name = cancel (matches the old prompt behaviour)
    return
  }
  ui.resolveNewProject({
    name: trimmed,
    region: region.value,
    template: template.value,
    withBoilerplate: boilerplate.value
  })
}

function cancel(): void {
  ui.cancelNewProject()
}
</script>

<template>
  <div
    v-if="ui.newProject"
    class="np-scrim"
    @click.self="cancel"
    @keydown.esc="cancel"
  >
    <div class="np-card" role="dialog" aria-modal="true" :aria-label="ui.newProject.title">
      <span class="bc-label np-title">{{ ui.newProject.title }}</span>

      <span class="bc-label np-field-label">{{ ui.newProject.nameLabel }}</span>
      <input
        ref="inputRef"
        v-model="name"
        class="np-input"
        type="text"
        spellcheck="false"
        :placeholder="ui.newProject.namePlaceholder ?? ''"
        @keydown.enter="confirm"
        @keydown.esc="cancel"
      />

      <span class="bc-label np-field-label">{{ ui.newProject.templateLabel }}</span>
      <ul class="np-modes">
        <li v-for="tpl in ui.newProject.templates" :key="tpl.value">
          <label class="np-mode">
            <input
              type="radio"
              name="np-template"
              :value="tpl.value"
              :checked="template === tpl.value"
              @change="template = tpl.value"
            />
            <span class="np-mode-text">
              <span class="np-mode-name">{{ tpl.label }}</span>
              <span v-if="tpl.hint" class="np-mode-hint">{{ tpl.hint }}</span>
            </span>
          </label>
        </li>
      </ul>

      <span class="bc-label np-field-label">{{ ui.newProject.regionLabel }}</span>
      <ul class="np-modes">
        <li v-for="r in ui.newProject.regions" :key="r.value">
          <label class="np-mode">
            <input
              type="radio"
              name="np-region"
              :value="r.value"
              :checked="region === r.value"
              @change="region = r.value"
            />
            <span class="np-mode-text">
              <span class="np-mode-name">{{ r.label }}</span>
              <span v-if="r.hint" class="np-mode-hint">{{ r.hint }}</span>
            </span>
          </label>
        </li>
      </ul>

      <label class="np-boilerplate">
        <input v-model="boilerplate" type="checkbox" />
        <span>{{ ui.newProject.boilerplateLabel }}</span>
      </label>

      <footer class="np-actions">
        <button class="tbtn" @click="cancel">{{ t('dialog.cancel') }}</button>
        <button class="tbtn tbtn-primary" @click="confirm">{{ ui.newProject.confirmLabel }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.np-scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 15, 0.7);
}
.np-card {
  display: flex;
  flex-direction: column;
  width: 460px;
  max-width: calc(100vw - 48px);
  padding: var(--bc-space-6);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
}
.np-title {
  display: block;
}
.np-field-label {
  display: block;
  margin: var(--bc-space-4) 0 var(--bc-space-2);
}
.np-input {
  height: 38px;
  padding: 0 var(--bc-space-3);
  font: 400 14px/1 var(--bc-font-mono);
  color: var(--bc-text-100);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
}
.np-input:focus {
  outline: none;
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.np-modes {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.np-mode {
  display: flex;
  align-items: flex-start;
  gap: var(--bc-space-3);
  padding: var(--bc-space-3);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
}
.np-mode-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.np-mode-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.np-mode-name {
  font: 400 14px/1.2 var(--bc-font-mono);
  color: var(--bc-text-100);
}
.np-mode-hint {
  font: 400 12px/1.3 var(--bc-font-sans);
  color: var(--bc-text-300);
}
.np-boilerplate {
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  margin-top: var(--bc-space-4);
  font: 400 13px/1.3 var(--bc-font-sans);
  color: var(--bc-text-200);
  cursor: pointer;
}
.np-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--bc-space-2);
  margin-top: var(--bc-space-6);
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import type { Locale, StartupMode } from '@shared/ipc'

const { t } = useI18n()
const settings = useSettingsStore()

type CategoryId = 'general' | 'emulator' | 'language'
const categories = computed<{ id: CategoryId; label: string }[]>(() => [
  { id: 'general', label: t('settings.cat.general') },
  { id: 'emulator', label: t('settings.cat.emulator') },
  { id: 'language', label: t('settings.cat.language') }
])
const active = ref<CategoryId>('general')

const startupOptions = computed<{ value: StartupMode; label: string }[]>(() => [
  { value: 'welcome', label: t('settings.startup.welcome') },
  { value: 'last', label: t('settings.startup.last') }
])

const languageOptions = computed<{ value: Locale; label: string }[]>(() => [
  { value: 'de', label: t('settings.language.de') },
  { value: 'en', label: t('settings.language.en') }
])
</script>

<template>
  <div v-if="settings.open" class="settings-scrim" @click.self="settings.cancel()">
    <div class="settings-card" role="dialog" aria-modal="true" :aria-label="t('settings.title')">
      <header class="settings-head">
        <span class="bc-label">{{ t('settings.title') }}</span>
        <button
          class="settings-close tbtn tbtn-icon"
          :title="t('settings.close')"
          :aria-label="t('settings.close')"
          @click="settings.cancel()"
        >
          <svg class="ico" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      <div class="settings-body">
        <!-- left: category list -->
        <nav class="settings-cats" :aria-label="t('settings.title')">
          <button
            v-for="c in categories"
            :key="c.id"
            class="settings-cat"
            :class="{ 'is-active': active === c.id }"
            @click="active = c.id"
          >
            {{ c.label }}
          </button>
        </nav>

        <!-- right: options for the active category -->
        <section class="settings-pane">
          <template v-if="active === 'general'">
            <h3 class="bc-h3 settings-pane-title">{{ t('settings.cat.general') }}</h3>
            <div class="settings-field">
              <span class="bc-label settings-field-label">{{ t('settings.startup.label') }}</span>
              <div class="settings-radios">
                <label v-for="o in startupOptions" :key="o.value" class="settings-radio">
                  <input
                    type="radio"
                    name="startupMode"
                    :value="o.value"
                    v-model="settings.draftStartupMode"
                  />
                  <span>{{ o.label }}</span>
                </label>
              </div>
            </div>
          </template>

          <template v-else-if="active === 'emulator'">
            <h3 class="bc-h3 settings-pane-title">{{ t('settings.emulator.title') }}</h3>
            <p class="bc-body settings-intro">
              {{ t('settings.emulator.intro', { exe: 'x64sc' }) }}
            </p>
            <span class="bc-label settings-field-label">{{
              t('settings.emulator.fieldLabel')
            }}</span>
            <div class="settings-path-row">
              <input
                v-model="settings.draftVicePath"
                class="settings-input"
                type="text"
                spellcheck="false"
                :placeholder="t('settings.emulator.placeholder')"
                @blur="settings.revalidateVice()"
              />
              <button class="tbtn" @click="settings.browseVice()">
                {{ t('settings.emulator.browse') }}
              </button>
            </div>
            <p
              v-if="settings.draftVicePath && settings.viceCheck"
              class="settings-hint"
              :class="{
                ok: settings.viceCheck.exists && settings.viceCheck.looksLikeVice,
                warn: settings.viceCheck.exists && !settings.viceCheck.looksLikeVice,
                bad: !settings.viceCheck.exists
              }"
            >
              <template v-if="!settings.viceCheck.exists">
                {{ t('settings.emulator.notFound') }}
              </template>
              <template v-else-if="!settings.viceCheck.looksLikeVice">
                {{ t('settings.emulator.notVice', { exe: 'x64sc' }) }}
              </template>
              <template v-else> {{ t('settings.emulator.found') }} </template>
            </p>
          </template>

          <template v-else-if="active === 'language'">
            <h3 class="bc-h3 settings-pane-title">{{ t('settings.language.title') }}</h3>
            <div class="settings-field">
              <span class="bc-label settings-field-label">{{
                t('settings.language.label')
              }}</span>
              <div class="settings-radios">
                <label v-for="o in languageOptions" :key="o.value" class="settings-radio">
                  <input
                    type="radio"
                    name="uiLanguage"
                    :value="o.value"
                    v-model="settings.draftLanguage"
                  />
                  <span>{{ o.label }}</span>
                </label>
              </div>
            </div>
          </template>
        </section>
      </div>

      <footer class="settings-actions">
        <button class="tbtn" @click="settings.cancel()">{{ t('settings.cancel') }}</button>
        <button class="tbtn tbtn-primary" @click="settings.apply()">
          {{ t('settings.apply') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.settings-scrim {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 15, 0.7);
}
.settings-card {
  display: flex;
  flex-direction: column;
  width: 760px;
  max-width: calc(100vw - 48px);
  height: 520px;
  max-height: calc(100vh - 48px);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
  overflow: hidden;
}
.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--bc-space-4) var(--bc-space-5);
  border-bottom: 1px solid var(--bc-border-subtle);
}
.settings-close {
  flex: 0 0 auto;
}
.settings-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}
.settings-cats {
  flex: 0 0 200px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--bc-space-3);
  border-right: 1px solid var(--bc-border-subtle);
  background: rgba(0, 0, 0, 0.18);
}
.settings-cat {
  text-align: left;
  padding: var(--bc-space-2) var(--bc-space-3);
  font: 500 13px/1.2 var(--bc-font-sans);
  color: var(--bc-text-300);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--bc-radius-md);
  cursor: pointer;
}
.settings-cat:hover {
  color: var(--bc-text-100);
  background: rgba(94, 196, 255, 0.06);
}
.settings-cat.is-active {
  color: var(--bc-text-100);
  background: rgba(94, 196, 255, 0.1);
  border-color: var(--bc-border);
}
.settings-pane {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--bc-space-5);
  overflow-y: auto;
}
.settings-pane-title {
  margin: 0 0 var(--bc-space-4);
}
.settings-intro {
  color: var(--bc-text-300);
  margin: 0 0 var(--bc-space-4);
}
.settings-field {
  margin-bottom: var(--bc-space-5);
}
.settings-field-label {
  display: block;
  margin-bottom: var(--bc-space-2);
}
.settings-radios {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
}
.settings-radio {
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  font: 400 13px/1 var(--bc-font-sans);
  color: var(--bc-text-100);
  cursor: pointer;
}
.settings-path-row {
  display: flex;
  gap: var(--bc-space-2);
}
.settings-input {
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
.settings-input:focus {
  outline: none;
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.settings-hint {
  margin: var(--bc-space-2) 0 0;
  font: 400 12px/1.4 var(--bc-font-sans);
}
.settings-hint.ok {
  color: var(--bc-success);
}
.settings-hint.warn {
  color: var(--bc-warning);
}
.settings-hint.bad {
  color: var(--bc-danger);
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
.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--bc-space-2);
  padding: var(--bc-space-4) var(--bc-space-5);
  border-top: 1px solid var(--bc-border-subtle);
}
</style>

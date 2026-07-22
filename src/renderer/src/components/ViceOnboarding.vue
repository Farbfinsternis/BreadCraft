<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'

// First-run VICE onboarding (T2 + T3): one screen that guides a stranger to a runnable
// emulator without a dead end. States, driven by the store:
//   • busy (downloading / verifying / extracting) → progress view (T3)
//   • error → friendly message + fallbacks (retry / manual page / link)
//   • detected → a "found — use it?" banner (one click)
//   • otherwise → the three-way screen: download / link existing / later
// "Later" always leaves: writing and building a .prg never needs VICE (only running).
const { t } = useI18n()
const settings = useSettingsStore()

const busy = computed(() =>
  ['downloading', 'verifying', 'extracting'].includes(settings.onboardingPhase)
)
const phaseLabel = computed(() => {
  switch (settings.onboardingPhase) {
    case 'downloading':
      return settings.onboardingPercent === null
        ? t('onboarding.dlDownloading')
        : t('onboarding.dlDownloadingPct', { pct: settings.onboardingPercent })
    case 'verifying':
      return t('onboarding.dlVerifying')
    case 'extracting':
      return t('onboarding.dlExtracting')
    default:
      return ''
  }
})
const isChecksumError = computed(() => (settings.onboardingError ?? '').includes('checksum'))
</script>

<template>
  <div
    v-if="settings.onboardingOpen"
    class="onb-scrim"
    role="dialog"
    aria-modal="true"
    :aria-label="t('onboarding.title')"
  >
    <div class="onb-card">
      <button
        v-if="!busy"
        class="onb-close tbtn tbtn-icon"
        :title="t('onboarding.close')"
        :aria-label="t('onboarding.close')"
        @click="settings.onboardingLater()"
      >
        <svg class="ico" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>

      <div class="onb-hero" aria-hidden="true">
        <svg class="onb-ico" viewBox="0 0 24 24">
          <rect x="2" y="4" width="20" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </div>
      <h2 class="onb-title">{{ t('onboarding.title') }}</h2>

      <!-- Busy: the in-app download is running (T3). -->
      <template v-if="busy">
        <p class="onb-body">{{ phaseLabel }}</p>
        <div class="onb-progress" :class="{ indeterminate: settings.onboardingPercent === null }">
          <div
            class="onb-progress-fill"
            :style="settings.onboardingPercent !== null ? { width: settings.onboardingPercent + '%' } : {}"
          />
        </div>
        <p class="onb-body onb-why">{{ t('onboarding.dlPatience') }}</p>
      </template>

      <!-- Error: friendly message + fallbacks (retry / manual page / link). -->
      <template v-else-if="settings.onboardingPhase === 'error'">
        <h3 class="onb-subtitle">{{ t('onboarding.dlErrorTitle') }}</h3>
        <p class="onb-body">
          {{ isChecksumError ? t('onboarding.dlErrorChecksum') : t('onboarding.dlErrorBody') }}
        </p>
        <div class="onb-choices">
          <button class="onb-choice is-primary" @click="settings.onboardingDownload()">
            <span class="onb-choice-title">{{ t('onboarding.retry') }}</span>
          </button>
          <button class="onb-choice" @click="settings.onboardingOpenPage()">
            <span class="onb-choice-title">{{ t('onboarding.openPage') }}</span>
            <span class="onb-choice-sub">{{ t('onboarding.openPageHint') }}</span>
          </button>
          <button class="onb-choice" @click="settings.onboardingLink()">
            <span class="onb-choice-title">{{ t('onboarding.chooseFolder') }}</span>
          </button>
          <button class="onb-choice" @click="settings.onboardingLater()">
            <span class="onb-choice-title">{{ t('onboarding.later') }}</span>
          </button>
        </div>
        <p v-if="settings.onboardingNote === 'link-notfound'" class="onb-note bad">
          {{ t('settings.emulator.folderNoVice', { exe: 'x64sc' }) }}
        </p>
      </template>

      <!-- Found: BreadCraft detected a VICE install — one click to adopt it. -->
      <template v-else-if="settings.onboardingDetected">
        <p class="onb-body">{{ t('onboarding.foundIntro') }}</p>
        <p class="onb-path">{{ settings.onboardingDetected }}</p>
        <p class="onb-body onb-why">{{ t('onboarding.foundWhy') }}</p>
        <div class="onb-actions">
          <button class="tbtn tbtn-lg tbtn-primary" @click="settings.onboardingUseDetected()">
            {{ t('onboarding.use') }}
          </button>
          <button class="tbtn tbtn-lg" @click="settings.onboardingLink()">
            {{ t('onboarding.chooseOther') }}
          </button>
          <button class="tbtn tbtn-lg tbtn-ghost" @click="settings.onboardingLater()">
            {{ t('onboarding.later') }}
          </button>
        </div>
      </template>

      <!-- Not found: the three-way screen. -->
      <template v-else>
        <p class="onb-body">{{ t('onboarding.missingIntro') }}</p>
        <div class="onb-choices">
          <button class="onb-choice is-primary" @click="settings.onboardingDownload()">
            <span class="onb-choice-title">{{ t('onboarding.download') }}</span>
            <span class="onb-choice-sub">{{ t('onboarding.downloadHint') }}</span>
          </button>
          <button class="onb-choice" @click="settings.onboardingLink()">
            <span class="onb-choice-title">{{ t('onboarding.link') }}</span>
            <span class="onb-choice-sub">{{ t('onboarding.linkHint') }}</span>
          </button>
          <button class="onb-choice" @click="settings.onboardingLater()">
            <span class="onb-choice-title">{{ t('onboarding.later') }}</span>
            <span class="onb-choice-sub">{{ t('onboarding.laterHint') }}</span>
          </button>
        </div>
        <p class="onb-note onb-license">{{ t('onboarding.licenseNote') }}</p>
        <p v-if="settings.onboardingNote === 'link-notfound'" class="onb-note bad">
          {{ t('settings.emulator.folderNoVice', { exe: 'x64sc' }) }}
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.onb-scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 15, 0.78);
}
.onb-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 520px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  padding: var(--bc-space-7) var(--bc-space-6) var(--bc-space-6);
  text-align: center;
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
  overflow-y: auto;
}
.onb-close {
  position: absolute;
  top: var(--bc-space-3);
  right: var(--bc-space-3);
}
.onb-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--bc-space-4);
  border-radius: var(--bc-radius-lg);
  background: rgba(94, 196, 255, 0.08);
  border: 1px solid var(--bc-border);
}
.onb-ico {
  width: 34px;
  height: 34px;
  fill: none;
  stroke: var(--bc-arc-300);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.onb-title {
  margin: 0 0 var(--bc-space-4);
  font: 600 20px/1.2 var(--bc-font-sans);
  color: var(--bc-text-100);
}
.onb-body {
  margin: 0 0 var(--bc-space-3);
  max-width: 42ch;
  font: 400 14px/1.5 var(--bc-font-sans);
  color: var(--bc-text-300);
}
.onb-why {
  color: var(--bc-text-200);
}
.onb-path {
  margin: 0 0 var(--bc-space-4);
  padding: var(--bc-space-2) var(--bc-space-3);
  font: 400 12px/1.3 var(--bc-font-mono);
  color: var(--bc-arc-200);
  background: rgba(94, 196, 255, 0.06);
  border: 1px solid var(--bc-border-subtle);
  border-radius: var(--bc-radius-sm);
  word-break: break-all;
}
.onb-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--bc-space-2);
  margin-top: var(--bc-space-3);
}
.onb-choices {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  width: 100%;
  margin-top: var(--bc-space-3);
}
.onb-choice {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: var(--bc-space-3) var(--bc-space-4);
  text-align: left;
  background: var(--bc-bg-elev-1);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.onb-choice:hover {
  border-color: var(--bc-arc-400);
  background: var(--bc-bg-elev-2);
  box-shadow: var(--bc-glow-arc);
}
.onb-choice.is-primary {
  border-color: var(--bc-arc-400);
  background: rgba(94, 196, 255, 0.08);
}
.onb-choice-title {
  font: 600 14px/1.2 var(--bc-font-sans);
  color: var(--bc-text-100);
}
.onb-choice-sub {
  font: 400 12px/1.4 var(--bc-font-sans);
  color: var(--bc-text-400);
}
.onb-note {
  margin: var(--bc-space-3) 0 0;
  font: 400 12px/1.4 var(--bc-font-sans);
}
.onb-note.bad {
  color: var(--bc-danger);
}
.onb-license {
  color: var(--bc-text-400);
  text-align: center;
}
.onb-subtitle {
  margin: 0 0 var(--bc-space-3);
  font: 600 15px/1.2 var(--bc-font-sans);
  color: var(--bc-text-100);
}
.onb-progress {
  position: relative;
  width: 100%;
  height: 8px;
  margin: var(--bc-space-2) 0 var(--bc-space-3);
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--bc-border-subtle);
  border-radius: 999px;
  overflow: hidden;
}
.onb-progress-fill {
  height: 100%;
  width: 0;
  background: var(--bc-arc-400);
  border-radius: 999px;
  transition: width 160ms ease;
}
.onb-progress.indeterminate .onb-progress-fill {
  width: 40%;
  animation: onb-slide 1.1s ease-in-out infinite;
}
@keyframes onb-slide {
  0% {
    margin-left: -40%;
  }
  100% {
    margin-left: 100%;
  }
}
</style>

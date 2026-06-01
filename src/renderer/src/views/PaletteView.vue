<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  usePaletteStore,
  C64_PALETTE,
  SLOTS,
  type SlotKey,
  type C64Color
} from '../stores/palette'

const { t } = useI18n()
const palette = usePaletteStore()

// Ctrl/Cmd+S saves the palette (explicit save — no auto-save, ASSET_DOCUMENTS.md §2.5).
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void palette.save()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/** Which slot is currently armed for a click-assign (newbie path: pick slot, then
 *  click a colour). Defaults to the first slot so a click always lands somewhere. */
const activeSlot = ref<SlotKey>('background')

/** Source colour index during a drag (nerd path: drag a swatch onto a slot). */
const dragIndex = ref<number | null>(null)
const dropTarget = ref<SlotKey | null>(null)

function pickColor(index: number): void {
  palette.setSlot(activeSlot.value, index)
}

function onDragStart(color: C64Color): void {
  dragIndex.value = color.index
}
function onDragEnd(): void {
  dragIndex.value = null
  dropTarget.value = null
}
function onDrop(key: SlotKey): void {
  if (dragIndex.value !== null) palette.setSlot(key, dragIndex.value)
  dropTarget.value = null
  dragIndex.value = null
}
</script>

<template>
  <div class="palette-editor">
    <header class="pe-head">
      <div class="pe-head-text">
        <span class="bc-label">{{ t('view.palette.title') }}</span>
        <h4 class="bc-h4">{{ t('palette.subtitle') }}</h4>
        <p class="bc-body-sm">{{ t('palette.intro') }}</p>
      </div>
      <button
        class="pe-save"
        :disabled="!palette.dirty"
        :title="palette.dirty ? t('asset.unsaved') : t('asset.saved')"
        @click="palette.save()"
      >
        <span class="pe-save-dot" :class="{ 'is-dirty': palette.dirty }" />
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
        {{ t('asset.save') }}
      </button>
    </header>

    <div class="pe-grid">
      <!-- The three shared slots -->
      <section class="pe-slots">
        <span class="bc-overline">{{ t('palette.sharedColors') }}</span>
        <article
          v-for="slot in SLOTS"
          :key="slot.key"
          class="pe-slot"
          :class="{ 'is-active': activeSlot === slot.key, 'is-drop': dropTarget === slot.key }"
          tabindex="0"
          @click="activeSlot = slot.key"
          @keydown.enter="activeSlot = slot.key"
          @dragover.prevent="dropTarget = slot.key"
          @dragleave="dropTarget === slot.key && (dropTarget = null)"
          @drop.prevent="onDrop(slot.key)"
        >
          <div
            class="pe-slot-chip"
            :style="{ background: palette.colorOf(slot.key).hex }"
          />
          <div class="pe-slot-text">
            <span class="pe-slot-label">{{ t(slot.labelKey) }}</span>
            <span class="pe-slot-hint">{{ t(slot.hintKey) }}</span>
            <span class="pe-slot-current">
              {{ t(palette.colorOf(slot.key).i18nKey) }}
              <code class="pe-reg">{{ slot.register }}</code>
            </span>
          </div>
        </article>
      </section>

      <!-- The fixed 16-colour C64 swatch board -->
      <section class="pe-swatches">
        <span class="bc-overline">{{ t('palette.theColors') }}</span>
        <p class="bc-body-sm pe-swatch-hint">{{ t('palette.pickHint') }}</p>
        <div class="pe-board">
          <button
            v-for="color in C64_PALETTE"
            :key="color.index"
            class="pe-swatch"
            :class="{ 'is-dragging': dragIndex === color.index }"
            :style="{ background: color.hex }"
            :title="`${color.index} · ${t(color.i18nKey)}`"
            draggable="true"
            @click="pickColor(color.index)"
            @dragstart="onDragStart(color)"
            @dragend="onDragEnd"
          >
            <span class="pe-swatch-no">{{ color.index }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.palette-editor {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-5);
  padding: var(--bc-space-6);
  height: 100%;
  overflow: auto;
  background: var(--bc-grad-night);
}

.pe-head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--bc-space-4);
}
.pe-head-text {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  max-width: 60ch;
}
.pe-head .bc-h4 {
  margin: var(--bc-space-1) 0 0;
}
.pe-save {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  font: 600 11px/1 var(--bc-font-sans);
  letter-spacing: 0.02em;
  color: var(--bc-text-300);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-pill);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pe-save:hover:not(:disabled) {
  color: var(--bc-text-100);
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.pe-save:disabled {
  opacity: 0.5;
  cursor: default;
}
.pe-save .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pe-save-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  transition: background 120ms ease;
}
.pe-save-dot.is-dirty {
  background: var(--bc-filament);
  box-shadow: 0 0 6px var(--bc-filament);
}

.pe-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(280px, 1.2fr);
  gap: var(--bc-space-5);
  align-items: start;
}
@media (max-width: 880px) {
  .pe-grid {
    grid-template-columns: 1fr;
  }
}

.pe-slots,
.pe-swatches {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-3);
}

/* ---- Slot cards (canonical BreadCraft card) ---- */
.pe-slot {
  display: flex;
  align-items: center;
  gap: var(--bc-space-4);
  padding: var(--bc-space-4);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-bevel), var(--bc-shadow-2);
  cursor: pointer;
  transition:
    border-color 120ms cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 120ms cubic-bezier(0.2, 0.7, 0.2, 1),
    transform 80ms cubic-bezier(0.2, 0.7, 0.2, 1);
  outline: none;
}
.pe-slot:hover {
  border-color: var(--bc-border-strong);
}
.pe-slot.is-active {
  border-color: rgba(94, 196, 255, 0.5);
  box-shadow: var(--bc-bevel), var(--bc-glow-arc);
}
.pe-slot.is-drop {
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-bevel), var(--bc-glow-copper);
}
.pe-slot:focus-visible {
  box-shadow: var(--bc-bevel), var(--bc-glow-arc);
}

.pe-slot-chip {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  border-radius: var(--bc-radius-md);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 0 0 3px rgba(0, 0, 0, 0.35),
    0 2px 8px rgba(0, 0, 0, 0.5);
}

.pe-slot-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.pe-slot-label {
  font-family: var(--bc-font-sans);
  font-weight: 600;
  font-size: 15px;
  color: var(--bc-fg-strong);
}
.pe-slot-hint {
  font-size: 13px;
  line-height: 1.4;
  color: var(--bc-fg-muted);
}
.pe-slot-current {
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  margin-top: 2px;
  font-size: 12px;
  color: var(--bc-fg-dim);
}
.pe-reg {
  font-family: var(--bc-font-mono);
  font-size: 11px;
  color: var(--bc-arc-200);
  background: rgba(94, 196, 255, 0.06);
  border: 1px solid var(--bc-border-subtle);
  padding: 1px 5px;
  border-radius: var(--bc-radius-sm);
}

/* ---- Swatch board ---- */
.pe-swatch-hint {
  margin: 0;
}
.pe-board {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: var(--bc-space-2);
  padding: var(--bc-space-4);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-bevel), var(--bc-shadow-2);
}
.pe-swatch {
  position: relative;
  aspect-ratio: 1;
  border: 1px solid rgba(0, 0, 0, 0.4);
  border-radius: var(--bc-radius-sm);
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition:
    transform 80ms cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pe-swatch:hover {
  transform: translateY(-2px);
  box-shadow: var(--bc-glow-arc);
  z-index: 1;
}
.pe-swatch:active {
  transform: translateY(0) scale(0.96);
}
.pe-swatch.is-dragging {
  box-shadow: var(--bc-glow-copper);
  transform: scale(0.92);
}
.pe-swatch-no {
  position: absolute;
  left: 4px;
  bottom: 3px;
  font-family: var(--bc-font-mono);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}
</style>

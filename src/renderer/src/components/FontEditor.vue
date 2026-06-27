<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePaletteStore, C64_PALETTE } from '../stores/palette'
import { useCharsetStore } from '../stores/charset'
import PixelCanvas from './PixelCanvas.vue'
import PixelToolbar from './PixelToolbar.vue'
import { charPixelHexes } from '../pixel-engine/charsetRender'
import {
  indicesToBytesMC,
  bytesToIndicesMC,
  indicesToBytesHires,
  bytesToIndicesHires
} from '../pixel-engine/charsetBytes'
import type { PixelIndex, ToolId } from '../pixel-engine'
import { charForSlot, FONT_SLOTS } from '@shared/font-slots'
import { romGlyph } from '@shared/c64-rom-font'

/**
 * Hires Font editor (MIXED_MODE_FONT_PLAN F4) — the second face of the ONE charset:
 * it shapes the reserved Hires font slots 0–63 that DrawText draws crisp (8×8, 1 bpp,
 * one foreground colour), while the PETSCII tab paints the MC tiles. Same charset
 * store, no new asset/format — only the LENS differs (hi-res square pixels vs MC
 * double-wide). The store keeps every char as MC index cells; here we bridge that to
 * an 8×8 hi-res grid (MC cells → bytes → hi-res bits) for editing and back on commit
 * — lossless at the byte level, the C64 truth the .petscii file stores.
 */

const { t } = useI18n()
const palette = usePaletteStore()
const charset = useCharsetStore()

// A hi-res cell is 1 bpp: on/off. The REAL on-pixel colour is the cell's Color-RAM
// (set at runtime by Color/the pen), so the editor just shows a bright neutral sample
// for "set" — the glyph SHAPE is what's authored here, not its colour.
const FG_SAMPLE = C64_PALETTE[1].hex
const bg = computed(() => palette.colorOf('background'))
// PixelCanvas takes a 4-entry palette; hi-res only uses 0 (bg) and 1 (fg).
const hiresPalette = computed<string[]>(() => [bg.value.hex, FG_SAMPLE, FG_SAMPLE, FG_SAMPLE])

const fontSlots = Array.from({ length: FONT_SLOTS }, (_, i) => i)
const selectedSlot = ref(1) // open on 'A' (slot 1) — the friendliest starting glyph

const activeTool = ref<ToolId>('draw')
const canUndo = ref(false)
const canRedo = ref(false)
const canvasRef = ref<InstanceType<typeof PixelCanvas> | null>(null)

const leftIndex: PixelIndex = 1 // paint = foreground
const rightIndex: PixelIndex = 0 // erase = background (DPaint right button)

/** The 8×8 hi-res bits (0/1) for a slot: the painted glyph (store MC cells bridged to
 *  hi-res) or — while still unpainted — the C64 ROM glyph that the build would seed, so
 *  editing starts from the real default rather than a blank cell. */
function hiresOf(slot: number): Uint8Array {
  const bytes = charset.isUsed(slot)
    ? indicesToBytesMC(charset.pixels(slot))
    : romGlyph(slot).slice() // ROM glyph is readonly → a mutable copy for the converter
  return bytesToIndicesHires(bytes)
}

const currentCells = computed(() => hiresOf(selectedSlot.value))

/** A stroke landed — bridge the hi-res grid back to bytes → MC cells → the store. */
function onCanvasUpdate(cells: Uint8Array): void {
  charset.setPixels(selectedSlot.value, bytesToIndicesMC(indicesToBytesHires(cells)))
}
function onHistory(state: { canUndo: boolean; canRedo: boolean }): void {
  canUndo.value = state.canUndo
  canRedo.value = state.canRedo
}

/** The character a slot stands for ('A', '0', '!', …) or null for the symbol slots. */
function labelOf(slot: number): string | null {
  return charForSlot(slot)
}

/** 64 hex previews (8×8) of a slot's glyph for its navigator cell. */
function previewOf(slot: number): string[] {
  return charPixelHexes(hiresOf(slot), hiresPalette.value, false)
}

const selectedLabel = computed(() => labelOf(selectedSlot.value))
</script>

<template>
  <div class="fe">
    <!-- Navigator: the 64 font slots (the first 4 rows of the 256 grid → same column
         geometry as the PETSCII navigator, muscle memory preserved). -->
    <section class="fe-nav-panel">
      <header class="fe-nav-head">{{ t('font.navTitle') }}</header>
      <div class="fe-nav">
        <button
          v-for="s in fontSlots"
          :key="s"
          class="fe-cell"
          :class="{ 'is-sel': selectedSlot === s }"
          :style="{ background: bg.hex }"
          :title="labelOf(s) ? t('font.slotNamed', { c: labelOf(s), n: s }) : t('font.slot', { n: s })"
          @click="selectedSlot = s"
        >
          <span class="fe-mini">
            <i v-for="(hex, pi) in previewOf(s)" :key="pi" :style="{ background: hex }" />
          </span>
          <span v-if="labelOf(s)" class="fe-cell-label">{{ labelOf(s) }}</span>
        </button>
      </div>
    </section>

    <!-- The 8×8 hi-res canvas for the selected glyph. -->
    <section class="fe-canvas-panel">
      <header class="fe-canvas-head">
        <span class="fe-canvas-title">{{ t('font.editing', { n: selectedSlot }) }}</span>
        <span v-if="selectedLabel" class="fe-canvas-letter">{{ selectedLabel }}</span>
      </header>
      <div class="fe-canvas-wrap">
        <PixelCanvas
          ref="canvasRef"
          class="fe-canvas-host"
          :width="8"
          :height="8"
          :pixel-aspect="1"
          :cells="currentCells"
          :palette="hiresPalette"
          :tool="activeTool"
          :left-index="leftIndex"
          :right-index="rightIndex"
          @update="onCanvasUpdate"
          @history="onHistory"
        />
      </div>
      <p class="fe-hint">{{ t('font.hint') }}</p>
    </section>

    <!-- Tools (shared pixel toolbar). -->
    <section class="fe-tools-panel">
      <PixelToolbar
        v-model:tool="activeTool"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @undo="canvasRef?.undo()"
        @redo="canvasRef?.redo()"
      />
    </section>
  </div>
</template>

<style scoped>
.fe {
  display: flex;
  gap: var(--bc-space-4);
  align-items: stretch;
  height: 100%;
  padding: var(--bc-space-4);
  box-sizing: border-box;
}

/* ---- navigator ---- */
.fe-nav-panel {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  flex: 0 0 auto;
}
.fe-nav-head {
  font: 600 11px/1.2 var(--bc-font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bc-text-300);
}
.fe-nav {
  display: grid;
  grid-template-columns: repeat(16, 22px);
  grid-auto-rows: 22px;
  gap: 1px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: var(--bc-radius-sm);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
}
.fe-cell {
  position: relative;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 1px;
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow 100ms ease;
}
.fe-mini {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
}
.fe-mini i {
  display: block;
}
/* A faint letter in the corner so you can find a glyph at a glance (font editor). */
.fe-cell-label {
  position: absolute;
  right: 1px;
  bottom: 0;
  z-index: 2;
  font: 700 8px/1 var(--bc-font-mono, monospace);
  color: rgba(255, 255, 255, 0.55);
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}
.fe-cell:hover {
  box-shadow: 0 0 0 1px var(--bc-arc-300);
  z-index: 1;
}
.fe-cell.is-sel {
  box-shadow: 0 0 0 2px var(--bc-arc-400), 0 0 8px rgba(94, 196, 255, 0.6);
  z-index: 2;
}

/* ---- canvas ---- */
.fe-canvas-panel {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.fe-canvas-head {
  display: flex;
  align-items: baseline;
  gap: var(--bc-space-3);
}
.fe-canvas-title {
  font: 600 12px/1.2 var(--bc-font-sans);
  color: var(--bc-text-200);
}
.fe-canvas-letter {
  font: 700 18px/1 var(--bc-font-mono, monospace);
  color: #e6b87a;
}
.fe-canvas-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
}
.fe-canvas-host {
  aspect-ratio: 1 / 1;
  height: 100%;
  width: auto;
  max-width: 100%;
  max-height: 100%;
}
.fe-hint {
  margin: 0;
  font-size: 11px;
  color: var(--bc-text-400);
  text-align: center;
}

/* ---- tools ---- */
.fe-tools-panel {
  flex: 0 0 auto;
}
</style>

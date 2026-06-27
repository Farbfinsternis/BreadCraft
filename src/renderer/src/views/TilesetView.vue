<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePaletteStore, C64_PALETTE } from '../stores/palette'
import { usePanelsStore } from '../stores/panels'
import { useCharsetStore } from '../stores/charset'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import FloatPanel from '../components/FloatPanel.vue'
import PixelCanvas from '../components/PixelCanvas.vue'
import PixelToolbar from '../components/PixelToolbar.vue'
import FontEditor from '../components/FontEditor.vue'
import { charPixelHexes } from '../pixel-engine/charsetRender'
import type { PixelIndex, ToolId } from '../pixel-engine'
import { FONT_SLOTS } from '@shared/font-slots'

const { t } = useI18n()

/**
 * PETSCII-Tiles Editor — the THIN shell over the shared pixel engine (memory
 * breadcraft-pixel-engine, PETSCII_EDITOR.md §8.4). It feeds <PixelToolbar> +
 * <PixelCanvas> the grid size (8×8), the index→hex palette (from the project
 * palette), and the active pens; the engine itself lives in <PixelCanvas>. The
 * shell-only bits stay here: the tile navigator (slots 64–255 — the Hires font region
 * 0–63 is hidden, it lives in the Font tab), pen roles, the "X/192 tiles" budget
 * counter, and the Font / MetaTiles tabs.
 */

const palette = usePaletteStore()
const panels = usePanelsStore()
const charset = useCharsetStore()
const project = useProjectStore()
const ui = useUiStore()

const SCOPE = 'petscii'

// The character grid follows the project graphics mode (M2.T1, IDE.md §3.0):
// hi-res = 8×8 square pixels; multicolor = 4×8 double-WIDE pixels (pixelAspect 2:1),
// so the char is always 8 C64 pixels across. The store already sizes cells to match
// (pixelsPerChar, M1.T5); here we just tell <PixelCanvas> the shape.
const isMC = computed(() => project.graphicsMode === 'TEXT_MULTICOLOR')
const gridW = computed(() => (isMC.value ? 4 : 8))
const gridH = 8
const pixelAspect = computed(() => (isMC.value ? 2 : 1))

// The tools panel must always be tall enough to show every tool + undo/redo
// without scrolling (4 tool buttons in 2 rows + the history row + chrome).
const TOOLS_MIN_W = 120
const TOOLS_MIN_H = 230

// Default panel layout (seeded once; a saved arrangement wins — panels store).
// minSizes also bumps up any previously-saved tools panel that was too short.
panels.ensure(
  SCOPE,
  {
    charset: { x: 24, y: 24, width: 280, height: 300 },
    canvas: { x: 332, y: 24, width: 380, height: 440 },
    tools: { x: 736, y: 24, width: 200, height: TOOLS_MIN_H },
    colors: { x: 736, y: 24 + TOOLS_MIN_H + 16, width: 200, height: 230 }
  },
  { tools: { minWidth: TOOLS_MIN_W, minHeight: TOOLS_MIN_H } }
)

type Tab = 'paint' | 'font' | 'meta'
const tab = ref<Tab>('paint')

const activeTool = ref<ToolId>('draw')
const canUndo = ref(false)
const canRedo = ref(false)
const canvasRef = ref<InstanceType<typeof PixelCanvas> | null>(null)

// The MC tile editor shows ONLY tile territory: slots 64–255. The reserved Hires font
// region (0–63) lives entirely in the Font tab (MIXED_MODE_FONT_PLAN F3 → fully hidden
// here), so it can't be reached or overpainted. Selection opens on the first tile (64).
const selectedChar = ref(FONT_SLOTS)
const tileChars = Array.from({ length: 256 - FONT_SLOTS }, (_, i) => i + FONT_SLOTS)

const bg = computed(() => palette.colorOf('background'))
const s1 = computed(() => palette.colorOf('shared1'))
const s2 = computed(() => palette.colorOf('shared2'))

// Index → hex for the 4 MC colour sources (0=bg, 1=shared1, 2=shared2, 3=free).
// The "free" colour really lives in per-cell Color-RAM; the editor uses a fixed
// light sample colour for preview/paint (PETSCII_EDITOR.md §4).
const indexPalette = computed<string[]>(() => [
  bg.value.hex,
  s1.value.hex,
  s2.value.hex,
  C64_PALETTE[1].hex
])

// Pen picker (which index the LEFT button paints). Right button always paints
// background (DPaint erase). For now hi-res-style 4 roles are all offered.
const pens = computed<{ index: PixelIndex; label: string; color: string }[]>(() => [
  { index: 0, label: t('tileset.pen.bg'), color: bg.value.hex },
  { index: 1, label: t('tileset.pen.s1'), color: s1.value.hex },
  { index: 2, label: t('tileset.pen.s2'), color: s2.value.hex },
  { index: 3, label: t('tileset.pen.free'), color: C64_PALETTE[1].hex }
])
const leftIndex = ref<PixelIndex>(3)
const rightIndex: PixelIndex = 0 // background = DPaint erase

/** The selected character's cells (reactive Uint8Array from the store). */
const currentCells = computed(() => charset.pixels(selectedChar.value))

// ---- Leuchttisch (light table / onion skin) ----
// Shows the PREVIOUS charset slot (N−1) as a faint colour ghost behind the paint
// grid, so animation phases — painted into consecutive slots, then driven by the
// CRUMB AnimateTile command — can be aligned frame-to-frame. Editor-local: it knows
// nothing about AnimateTile, only slot order (the natural reference). Off for slot 0
// (no predecessor). Only the canvas gets it; the navigator stays clean.
const onionCells = computed<Uint8Array | null>(() => {
  if (!ui.lightTable) return null
  const prev = selectedChar.value - 1
  return prev < 0 ? null : charset.pixels(prev)
})

/** The engine emitted a new grid — write it straight back to the store. */
function onCanvasUpdate(cells: Uint8Array): void {
  charset.setPixels(selectedChar.value, cells)
}
function onHistory(state: { canUndo: boolean; canRedo: boolean }): void {
  canUndo.value = state.canUndo
  canRedo.value = state.canRedo
}

/** Per-C64-pixel hex list (always 64 = 8×8) for a character's navigator mini-preview.
 *  MC cells expand double-wide so the 8×8 mini-grid stays correct (charPixelHexes). */
function charPreview(charIndex: number): string[] {
  const p = charset.chars[charIndex]
  if (!p) return []
  return charPixelHexes(p, indexPalette.value, isMC.value)
}

function resetLayout(): void {
  panels.reset(SCOPE)
}

/** Save-As (P2.T0b): pick folder + name in the project, write the current charset there. */
function saveAs(): void {
  void project.saveAssetAs('charset', '.petscii', t('saveas.title.charset'))
}

// Tile budget (MIXED_MODE_FONT_PLAN F5 — the font reservation made visible, Health-Bar
// spirit): the font owns slots 0–63, so only 192 slots (64–255) are tile territory.
// The counter shows used TILES of that 192, never the full 256 — the 64-slot cost of
// crisp text is honest, not hidden.
const TILE_CAP = 256 - FONT_SLOTS // 192
const usedTiles = computed(() => {
  let n = 0
  for (const key of Object.keys(charset.chars)) {
    const slot = Number(key)
    if (slot >= FONT_SLOTS && charset.isUsed(slot)) n++
  }
  return n
})

// ---- Solid-Tool (S11): mark tiles solid in the Properties-Bar ----
// Solidity is a property of the TILE, not its map position (STAHL S11): a solid tile
// blocks the player wherever it sits, a letter never does — which is why HUD DrawText
// stops colliding. The CHECKBOX sets the selected tile; the BRUSH button turns the
// navigator into a paint surface (drag = solid, right-drag = clear), mirroring the
// pixel editor's left/right idiom (PixelCanvas: button 2 = the "undo" pen).
const solidBrush = ref(false)
const painting = ref(false)
let paintValue = true // what the current drag stroke writes (set vs clear)

/** The selected tile's solid flag, two-way for the checkbox. */
const selectedSolid = computed<boolean>({
  get: () => charset.isSolid(selectedChar.value),
  set: (v) => charset.setSolid(selectedChar.value, v)
})
const solidCount = computed(() => charset.solidCount())

/** Navigator pointerdown: in brush mode start a solid stroke; else just select. */
function onNavDown(c: number, e: PointerEvent): void {
  if (solidBrush.value) {
    paintValue = e.button !== 2 // right button clears, anything else sets
    painting.value = true
    selectedChar.value = c // keep the checkbox in sync with where you paint
    charset.setSolid(c, paintValue)
    return
  }
  if (e.button === 0) selectedChar.value = c
}
/** Drag across cells while a stroke is active → paint the same value. */
function onNavEnter(c: number): void {
  if (painting.value) charset.setSolid(c, paintValue)
}
function onNavUp(): void {
  painting.value = false
}

// Ctrl/Cmd+S saves the charset (explicit save — no auto-save, ASSET_DOCUMENTS.md §2.5).
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void charset.save()
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // End a solid-paint stroke even if the pointer is released off a navigator cell.
  window.addEventListener('pointerup', onNavUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerup', onNavUp)
})
</script>

<template>
  <div class="petscii">
    <!-- Giant engraved watermark — identifies the editor; panels may cover it. -->
    <span class="pt-watermark" aria-hidden="true">PETSCII</span>

    <!-- Tab strip: Malen / Font / MetaTiles -->
    <div class="pt-tabs">
      <button class="pt-tab" :class="{ 'is-active': tab === 'paint' }" @click="tab = 'paint'">
        {{ t('tileset.tab.paint') }}
      </button>
      <button class="pt-tab" :class="{ 'is-active': tab === 'font' }" @click="tab = 'font'">
        {{ t('tileset.tab.font') }}
      </button>
      <button class="pt-tab" :class="{ 'is-active': tab === 'meta' }" @click="tab = 'meta'">
        {{ t('tileset.tab.meta') }}
      </button>
      <div class="pt-tabs-spacer" />
      <button
        v-if="tab === 'paint'"
        class="pt-reset"
        :title="t('tileset.resetLayoutTitle')"
        @click="resetLayout"
      >
        <svg class="ico" viewBox="0 0 24 24">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
        </svg>
        {{ t('tileset.resetLayout') }}
      </button>
      <button
        v-if="tab === 'paint'"
        class="pt-reset"
        :title="t('saveas.title.charset')"
        @click="saveAs"
      >
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg>
        {{ t('saveas.save') }}
      </button>
      <!-- Leuchttisch (onion skin): show the previous tile (N−1) as a colour ghost
           beneath the pixels, to align animation phases. -->
      <button
        v-if="tab === 'paint'"
        class="pt-reset"
        :class="{ 'is-on': ui.lightTable }"
        :title="t('tileset.lightTableTitle')"
        :aria-pressed="ui.lightTable"
        @click="ui.toggleLightTable()"
      >
        <svg class="ico" viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
        {{ t('tileset.lightTable') }}
      </button>
      <button
        class="pt-save"
        :disabled="!charset.dirty"
        :title="charset.dirty ? t('asset.unsaved') : t('asset.saved')"
        @click="charset.save()"
      >
        <span class="pt-save-dot" :class="{ 'is-dirty': charset.dirty }" />
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
        {{ t('asset.save') }}
      </button>
      <span class="pt-counter" :title="t('tileset.counterTitle', { font: FONT_SLOTS })">
        <span class="pt-counter-val">{{ usedTiles }}</span> / {{ TILE_CAP }} {{ t('tileset.counterSuffix') }}
      </span>
    </div>

    <!-- ===== MALEN TAB — floating toolbox over the canvas surface ===== -->
    <div v-if="tab === 'paint'" class="pt-surface">
      <!-- Zeichensatz (navigator) -->
      <FloatPanel :scope="SCOPE" id="charset" :title="t('tileset.panel.charset')" :min-width="240" :min-height="160">
        <div class="pt-charset-body">
          <div class="pt-nav" @contextmenu.prevent>
            <button
              v-for="c in tileChars"
              :key="c"
              class="pt-nav-cell"
              :class="{ 'is-sel': selectedChar === c, 'is-brush': solidBrush }"
              :style="{ background: bg.hex }"
              :title="t('tilemap.tile', { n: c })"
              @pointerdown="onNavDown(c, $event)"
              @pointerenter="onNavEnter(c)"
            >
              <span
                v-if="charset.isUsed(c)"
                class="pt-nav-mini"
              >
                <i
                  v-for="(hex, pi) in charPreview(c)"
                  :key="pi"
                  :style="{ background: hex }"
                />
              </span>
              <!-- Solid-Tile ring (S11): a steel-grey frame marks a tile that blocks the player. -->
              <span v-if="charset.isSolid(c)" class="pt-nav-solid" aria-hidden="true" />
            </button>
          </div>

          <!-- Properties of the SELECTED tile (S11). First (today only) property:
               Solid. Built to grow — further per-tile properties slot in here. -->
          <aside class="pt-props">
            <span class="pt-props-title">{{ t('tileset.props.title', { n: selectedChar }) }}</span>
            <div class="pt-prop-row">
              <label class="pt-prop-label" for="pt-solid-check">{{ t('tileset.props.solid') }}</label>
              <input id="pt-solid-check" v-model="selectedSolid" class="pt-prop-check" type="checkbox" />
              <button
                class="pt-prop-brush"
                :class="{ 'is-active': solidBrush }"
                :title="t('tileset.props.solidBrush')"
                :aria-pressed="solidBrush"
                @click="solidBrush = !solidBrush"
              >
                <svg class="ico" viewBox="0 0 24 24">
                  <path d="M9.5 14.5 18 6a2.1 2.1 0 0 1 3 3l-8.5 8.5" />
                  <path d="M9.5 14.5a3 3 0 0 1 0 4.2C8 20.2 4 20.5 4 20.5s.3-4 1.8-5.5a3 3 0 0 1 3.7-.5z" />
                </svg>
              </button>
            </div>
            <p class="pt-props-hint">{{ t('tileset.props.solidHint', { n: solidCount }) }}</p>
          </aside>
        </div>
      </FloatPanel>

      <!-- Zeichen (8×8 canvas) — shared pixel engine -->
      <FloatPanel :scope="SCOPE" id="canvas" :title="t('tileset.panel.char', { n: selectedChar })" :min-width="200" :min-height="200">
        <div class="pt-canvas-wrap">
          <PixelCanvas
            ref="canvasRef"
            class="pt-canvas-host"
            :width="gridW"
            :height="gridH"
            :pixel-aspect="pixelAspect"
            :cells="currentCells"
            :palette="indexPalette"
            :tool="activeTool"
            :left-index="leftIndex"
            :right-index="rightIndex"
            :onion="onionCells"
            @update="onCanvasUpdate"
            @history="onHistory"
          />
        </div>
      </FloatPanel>

      <!-- Werkzeug — shared pixel toolbar -->
      <FloatPanel :scope="SCOPE" id="tools" :title="t('tileset.panel.tools')" :min-width="TOOLS_MIN_W" :min-height="TOOLS_MIN_H">
        <PixelToolbar
          v-model:tool="activeTool"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @undo="canvasRef?.undo()"
          @redo="canvasRef?.redo()"
        />
      </FloatPanel>

      <!-- Farben -->
      <FloatPanel :scope="SCOPE" id="colors" :title="t('tileset.panel.colors')" :min-width="160" :min-height="150">
        <p class="pt-pen-hint">{{ t('tileset.penHint') }}</p>
        <div class="pt-pens">
          <button
            v-for="pen in pens"
            :key="pen.index"
            class="pt-pen"
            :class="{ 'is-active': leftIndex === pen.index }"
            @click="leftIndex = pen.index"
          >
            <span class="pt-pen-chip" :style="{ background: pen.color }" />
            <span class="pt-pen-label">{{ pen.label }}</span>
          </button>
        </div>
      </FloatPanel>
    </div>

    <!-- ===== FONT TAB — Hires font editor for slots 0–63 (MIXED_MODE_FONT_PLAN F4) ===== -->
    <FontEditor v-else-if="tab === 'font'" />

    <!-- ===== METATILES TAB (placeholder, honest) ===== -->
    <div v-else class="pt-meta">
      <div class="pt-meta-stub">
        <span class="bc-label">{{ t('tileset.tab.meta') }}</span>
        <p class="bc-body">{{ t('tileset.metaSoon') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.petscii {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bc-grad-night);
  overflow: hidden;
}

/* Giant engraved "PETSCII" stamped into the navy plate. Copper at low opacity —
   a rim-light/engraving, not a fill (design system: copper in small doses). */
.pt-watermark {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  user-select: none;
  font-family: var(--bc-font-display);
  font-weight: 900;
  font-size: clamp(80px, min(20vw, 38vh), 340px);
  line-height: 0.9;
  letter-spacing: -0.03em;
  color: var(--bc-copper-300);
  opacity: 0.07;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.04);
}

/* ---- tab strip ---- */
.pt-tabs {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  height: 40px;
  padding: 0 var(--bc-space-4);
  background: var(--bc-grad-plate);
  border-bottom: 1px solid var(--bc-border);
  box-shadow: var(--bc-bevel);
  flex: none;
}
.pt-tab {
  height: 28px;
  padding: 0 var(--bc-space-4);
  font: 600 13px/1 var(--bc-font-sans);
  color: var(--bc-text-400);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--bc-radius-pill);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pt-tab:hover {
  color: var(--bc-text-200);
}
.pt-tab.is-active {
  color: var(--bc-text-100);
  border-color: var(--bc-border-strong);
  background: rgba(94, 196, 255, 0.08);
  box-shadow: var(--bc-glow-arc);
}
.pt-tabs-spacer {
  flex: 1;
}
.pt-reset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 12px;
  font: 600 11px/1 var(--bc-font-sans);
  letter-spacing: 0.02em;
  color: var(--bc-text-300);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border-copper);
  border-radius: var(--bc-radius-pill);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pt-reset:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-glow-copper);
}
/* Toggle "on" state (Leuchttisch): arc-blue lit, like an active editor mode. */
.pt-reset.is-on {
  color: var(--bc-arc-200);
  border-color: var(--bc-arc-400);
  background: rgba(94, 196, 255, 0.08);
  box-shadow: var(--bc-glow-arc);
}
.pt-reset.is-on .ico {
  stroke: var(--bc-arc-300);
}
.pt-reset .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: var(--bc-copper-300);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pt-save {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
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
.pt-save:hover:not(:disabled) {
  color: var(--bc-text-100);
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.pt-save:disabled {
  opacity: 0.5;
  cursor: default;
}
.pt-save .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pt-save-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  transition: background 120ms ease;
}
.pt-save-dot.is-dirty {
  background: var(--bc-filament);
  box-shadow: 0 0 6px var(--bc-filament);
}
.pt-counter {
  font: 500 11px/1 var(--bc-font-mono);
  color: var(--bc-text-400);
  letter-spacing: 0.04em;
}
.pt-counter-val {
  color: var(--bc-arc-300);
}

/* ---- floating-toolbox surface ---- */
.pt-surface {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* ---- charset panel body: navigator + properties side by side ---- */
.pt-charset-body {
  display: flex;
  gap: var(--bc-space-3);
  align-items: flex-start;
  height: 100%;
}

/* ---- navigator 16×16 ---- */
.pt-nav {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 1px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: var(--bc-radius-sm);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
}
/* Brush mode (Solid-Tool active): the navigator becomes a paint surface. */
.pt-nav-cell.is-brush {
  cursor: crosshair;
}

/* ---- properties bar (S11) ---- */
.pt-props {
  flex: 0 0 116px;
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  padding: var(--bc-space-2) 0;
}
.pt-props-title {
  font: 600 11px/1.2 var(--bc-font-sans);
  letter-spacing: 0.02em;
  color: var(--bc-text-300);
}
.pt-prop-row {
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
}
.pt-prop-label {
  flex: 1 1 auto;
  font: 500 12px/1 var(--bc-font-sans);
  color: var(--bc-text-200);
  cursor: pointer;
}
.pt-prop-check {
  flex: none;
  width: 15px;
  height: 15px;
  accent-color: var(--bc-arc-400);
  cursor: pointer;
}
.pt-prop-brush {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--bc-text-300);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-sm);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pt-prop-brush:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-border-strong);
}
.pt-prop-brush.is-active {
  color: var(--bc-arc-200);
  border-color: var(--bc-arc-400);
  background: rgba(94, 196, 255, 0.08);
  box-shadow: var(--bc-glow-arc);
}
.pt-prop-brush .ico {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pt-props-hint {
  margin: 0;
  font: 500 10.5px/1.3 var(--bc-font-mono);
  color: var(--bc-text-400);
  letter-spacing: 0.02em;
}
.pt-nav-cell {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 1px;
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow 100ms ease;
}
/* tiny 8×8 preview of a painted character inside its navigator cell */
.pt-nav-mini {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
}
.pt-nav-mini i {
  display: block;
}
/* Solid-Tile ring (S11): a steel-grey frame inside the navigator cell marking a tile
   that blocks the player. Reads instantly, doesn't cover the char art (just a border),
   and sits BELOW the font ghost (z 2 vs 3) so the lens still wins on top. */
.pt-nav-solid {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  border: 2px solid #8b97a8;
  border-radius: 1px;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.55),
    0 0 4px rgba(139, 151, 168, 0.5);
}

.pt-nav-cell:hover {
  box-shadow: 0 0 0 1px var(--bc-arc-300);
  z-index: 1;
}
.pt-nav-cell.is-sel {
  box-shadow: 0 0 0 2px var(--bc-arc-400), 0 0 8px rgba(94, 196, 255, 0.6);
  z-index: 2;
}

/* ---- canvas ----
   Wrapper fills the panel body and centers the canvas. The canvas stays SQUARE
   no matter the panel proportions (WYSIWYG — a char's pixel grid must never
   distort, BREADCRAFT_IDE.md §3.0): aspect-ratio 1 + capping BOTH axes makes it
   size to whichever of width/height is the smaller. */
.pt-canvas-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 0;
}
/* Keep the canvas SQUARE regardless of panel proportions (WYSIWYG — a char's
   pixel grid must never distort, BREADCRAFT_IDE.md §3.0): bind to height, let
   aspect-ratio derive width, cap both axes → sized to the smaller axis. The
   per-pixel aspect (hi-res 1:1 / MC 2:1) is handled inside <PixelCanvas>. */
.pt-canvas-host {
  aspect-ratio: 1 / 1;
  height: 100%;
  width: auto;
  max-width: 100%;
  max-height: 100%;
}

/* ---- colours ---- */
.pt-pen-hint {
  margin: 0 0 var(--bc-space-2);
  font-size: 11px;
  color: var(--bc-text-400);
}
.pt-pens {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
}
.pt-pen {
  display: flex;
  align-items: center;
  gap: var(--bc-space-3);
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pt-pen:hover {
  border-color: var(--bc-border-strong);
}
.pt-pen.is-active {
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.pt-pen-chip {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--bc-radius-sm);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 0 0 2px rgba(0, 0, 0, 0.35);
}
.pt-pen-label {
  font: 500 12.5px/1 var(--bc-font-sans);
  color: var(--bc-text-200);
}

/* ---- metatiles placeholder ---- */
.pt-meta {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pt-meta-stub {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--bc-space-3);
  text-align: center;
}
.pt-meta-stub .bc-body {
  color: var(--bc-text-400);
  max-width: 320px;
}
</style>

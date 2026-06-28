<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePaletteStore, C64_PALETTE } from '../stores/palette'
import { usePanelsStore } from '../stores/panels'
import { useUiStore } from '../stores/ui'
import { useSpriteStore } from '../stores/sprite'
import { useProjectStore } from '../stores/project'
import FloatPanel from '../components/FloatPanel.vue'
import PixelCanvas from '../components/PixelCanvas.vue'
import PixelToolbar from '../components/PixelToolbar.vue'
import { spritePixelHexes } from '../pixel-engine/spriteRender'
import type { PixelIndex, ToolId } from '../pixel-engine'

const { t } = useI18n()

/**
 * Sprite Editor (P2.T2) — the THIN shell over the shared pixel engine, the sprite
 * sibling of TilesetView. It feeds <PixelToolbar> + <PixelCanvas> the grid size
 * (24×21 hi-res / 12×21 MC) and the index→hex palette; the engine lives in
 * <PixelCanvas>. Shell-only bits: the FRAME strip (one figure, many animation
 * frames — the P2.T1 decision), pen roles, frame counter. A frame = one picture of
 * the figure; ITD uses only frame 0, but the strip lets later animation grow.
 */

const palette = usePaletteStore()
const panels = usePanelsStore()
const ui = useUiStore()
const sprite = useSpriteStore()
const project = useProjectStore()

const SCOPE = 'sprite'

// The sprite grid follows the project graphics mode (IDE.md §3.0): hi-res 24×21
// square pixels; multicolor 12×21 double-WIDE pixels (pixelAspect 2:1), so the
// sprite is always 24 C64 pixels across. The store sizes cells to match.
const isMC = computed(() => project.graphicsMode === 'TEXT_MULTICOLOR')
const gridW = computed(() => (isMC.value ? 12 : 24))
const gridH = 21
const pixelAspect = computed(() => (isMC.value ? 2 : 1))

const TOOLS_MIN_W = 120
const TOOLS_MIN_H = 230

panels.ensure(
  SCOPE,
  {
    frames: { x: 24, y: 24, width: 200, height: 360 },
    canvas: { x: 252, y: 24, width: 360, height: 460 },
    tools: { x: 636, y: 24, width: 200, height: TOOLS_MIN_H },
    colors: { x: 636, y: 24 + TOOLS_MIN_H + 16, width: 200, height: 200 }
  },
  { tools: { minWidth: TOOLS_MIN_W, minHeight: TOOLS_MIN_H } }
)

const activeTool = ref<ToolId>('draw')
const canUndo = ref(false)
const canRedo = ref(false)
const canvasRef = ref<InstanceType<typeof PixelCanvas> | null>(null)

const selectedFrame = ref(0)

const bg = computed(() => palette.colorOf('background'))
const s1 = computed(() => palette.colorOf('shared1'))
const s2 = computed(() => palette.colorOf('shared2'))

// Index → hex for the 4 MC sprite colour sources: 0 transparent (shown as the
// project background), 1 spr-mcolor0 (shared1), 2 the sprite's INDIVIDUAL colour
// (per-sprite, chosen below + stored in the .sprite), 3 spr-mcolor1 (shared2).
// NOTE this differs from the charset's index 3 = Color-RAM — sprite MC pairs map to
// different registers (PETSCII_FORMAT/sprite_mc.c), but the editor paints the same
// four index roles.
const indiv = computed(() => C64_PALETTE[sprite.color])
const indexPalette = computed<string[]>(() => [bg.value.hex, s1.value.hex, indiv.value.hex, s2.value.hex])

const pens = computed<{ index: PixelIndex; label: string; color: string }[]>(() => [
  { index: 0, label: t('sprite.pen.bg'), color: bg.value.hex },
  { index: 1, label: t('sprite.pen.s1'), color: s1.value.hex },
  { index: 2, label: t('sprite.pen.color'), color: indiv.value.hex },
  { index: 3, label: t('sprite.pen.s2'), color: s2.value.hex }
])
const leftIndex = ref<PixelIndex>(2)
const rightIndex: PixelIndex = 0 // transparent = DPaint erase

const frameIndices = computed(() => Array.from({ length: sprite.frameCount() }, (_, i) => i))

// Keep the selection in range when the bound sprite changes (e.g. opening another
// file from the explorer): a shorter sprite must not leave us pointing past its end.
watch(
  () => sprite.frameCount(),
  (count) => {
    if (selectedFrame.value >= count) selectedFrame.value = Math.max(0, count - 1)
  }
)

/** The selected frame's cells (reactive Uint8Array from the store). */
const currentCells = computed(() => sprite.pixels(selectedFrame.value))

// ---- Leuchttisch (light table / onion skin) ----
// Shows the PREVIOUS frame (N−1) as a faint colour ghost behind the paint grid, so
// animation phases — drawn into consecutive frames, then driven by `Sprite n,x,y,frame`
// (SA4) — can be aligned frame-to-frame. The previous frame in the strip is the
// natural reference (cleaner than the charset's slot order). Editor-local: it knows
// nothing about the pointer swap, only strip order. Off for frame 0 (no predecessor).
// Shares the global `ui.lightTable` toggle with the Tileset editor (SPRITE_ANIMATIONS SA5).
const onionCells = computed<Uint8Array | null>(() => {
  if (!ui.lightTable) return null
  const prev = selectedFrame.value - 1
  return prev < 0 ? null : sprite.pixels(prev)
})

/** Pick the figure's individual colour and arm its pen, so the next stroke uses it. */
function pickIndivColor(index: number): void {
  sprite.setColor(index)
  leftIndex.value = 2
}

function onCanvasUpdate(cells: Uint8Array): void {
  sprite.setPixels(selectedFrame.value, cells)
}
function onHistory(state: { canUndo: boolean; canRedo: boolean }): void {
  canUndo.value = state.canUndo
  canRedo.value = state.canRedo
}

/** Per-C64-pixel hex list (504 = 24×21) for a frame's strip mini-preview. */
function framePreview(frameIndex: number): string[] {
  const f = sprite.frames[frameIndex]
  if (!f) return []
  return spritePixelHexes(f, indexPalette.value, isMC.value)
}

function addFrame(): void {
  selectedFrame.value = sprite.addFrame()
}
function removeFrame(frameIndex: number): void {
  sprite.removeFrame(frameIndex)
  if (selectedFrame.value >= sprite.frameCount()) selectedFrame.value = sprite.frameCount() - 1
}

function resetLayout(): void {
  panels.reset(SCOPE)
}

/** Save-As (P2.T0b): pick folder + name in the project, write the current sprite there. */
function saveAs(): void {
  void project.saveAssetAs('sprite', '.sprite', t('saveas.title.sprite'))
}

/** New sprite: a fresh, UNSAVED scratch canvas — the editor is a sketch pad. Nothing
 *  is written until the user later chooses "Save as"; an unkept doodle leaves no file.
 *  If the current sprite has unsaved edits we ask before discarding (a misclick must
 *  not silently lose work); Cancel keeps everything as-is. */
async function newSprite(): Promise<void> {
  if (sprite.dirty) {
    const ok = await ui.confirm({
      title: t('sprite.newSprite'),
      message: t('sprite.newDiscardWarn'),
      confirmLabel: t('sprite.newDiscardConfirm')
    })
    if (!ok) return // cancelled — keep the current drawing
  }
  sprite.newBlank()
  selectedFrame.value = 0
}

const frameTotal = computed(() => sprite.frameCount())

// ---- Sprite-island footprint (SA6) — make the honest 16/32-block ceiling felt
// WHILE drawing, not only when the build stops. Each frame bakes one 64-byte block
// of the shared sprite island; the island holds 16 blocks when the project uses a
// charset (VIC bank 1) and 32 without (bank 0) — the same prediction the RAM bar
// uses (charset presence). This is THIS sprite's footprint; all sprites share the
// island, so the exact project-wide total is the build's word (the honest overflow
// error, SA2). The tooltip says so. Amber as this one sprite nears the ceiling, red
// if it alone exceeds it.
const islandBudget = computed(() => (project.assets.charsets.length > 0 ? 16 : 32))
const islandState = computed<'ok' | 'warn' | 'over'>(() => {
  if (frameTotal.value > islandBudget.value) return 'over'
  if (frameTotal.value / islandBudget.value >= 0.75) return 'warn'
  return 'ok'
})

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void sprite.save()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="sprite">
    <span class="sp-watermark" aria-hidden="true">SPRITE</span>

    <!-- Action strip (one paint surface; no MetaTiles equivalent) -->
    <div class="sp-tabs">
      <span class="sp-title">{{ t('view.sprite.title') }}</span>
      <div class="sp-tabs-spacer" />
      <button class="sp-reset" :title="t('sprite.resetLayoutTitle')" @click="resetLayout">
        <svg class="ico" viewBox="0 0 24 24">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
        </svg>
        {{ t('sprite.resetLayout') }}
      </button>
      <button class="sp-reset" :title="t('sprite.newSpriteTitle')" @click="newSprite">
        <svg class="ico" viewBox="0 0 24 24"><path d="M14 3v5h5M14 3l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M12 11v6M9 14h6" /></svg>
        {{ t('sprite.newSprite') }}
      </button>
      <button class="sp-reset" :title="t('saveas.title.sprite')" @click="saveAs">
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg>
        {{ t('saveas.save') }}
      </button>
      <!-- Leuchttisch (onion skin): show the previous frame (N−1) as a colour ghost
           beneath the pixels, to align animation phases (SA5). -->
      <button
        class="sp-reset"
        :class="{ 'is-on': ui.lightTable }"
        :title="t('sprite.lightTableTitle')"
        :aria-pressed="ui.lightTable"
        @click="ui.toggleLightTable()"
      >
        <svg class="ico" viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
        {{ t('sprite.lightTable') }}
      </button>
      <button
        class="sp-save"
        :disabled="!sprite.dirty"
        :title="sprite.dirty ? t('asset.unsaved') : t('asset.saved')"
        @click="sprite.save()"
      >
        <span class="sp-save-dot" :class="{ 'is-dirty': sprite.dirty }" />
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
        {{ t('asset.save') }}
      </button>
      <span class="sp-counter" :title="t('sprite.counterTitle')">
        <span class="sp-counter-val">{{ frameTotal }}</span> {{ t('sprite.counterSuffix') }}
      </span>
      <span class="sp-island" :class="`is-${islandState}`" :title="t('sprite.islandTitle')">
        {{ t('sprite.island') }} <span class="sp-island-val">{{ frameTotal }}/{{ islandBudget }}</span>
      </span>
    </div>

    <div class="sp-surface">
      <!-- Frame strip (one figure, many animation frames) -->
      <FloatPanel :scope="SCOPE" id="frames" :title="t('sprite.panel.frames')" :min-width="150" :min-height="160">
        <div class="sp-frames">
          <div
            v-for="f in frameIndices"
            :key="f"
            class="sp-frame"
            :class="{ 'is-sel': selectedFrame === f }"
            @click="selectedFrame = f"
          >
            <span class="sp-frame-mini" :style="{ background: bg.hex }">
              <i v-for="(hex, pi) in framePreview(f)" :key="pi" :style="{ background: hex }" />
            </span>
            <span class="sp-frame-no">{{ f }}</span>
            <button
              v-if="frameTotal > 1"
              class="sp-frame-del"
              :title="t('sprite.removeFrameTitle')"
              @click.stop="removeFrame(f)"
            >
              ×
            </button>
          </div>
          <button class="sp-frame-add" :title="t('sprite.addFrameTitle')" @click="addFrame">
            <span class="sp-frame-add-plus">+</span>
            <span>{{ t('sprite.addFrame') }}</span>
          </button>
        </div>
      </FloatPanel>

      <!-- Sprite canvas (24×21) — shared pixel engine -->
      <FloatPanel
        :scope="SCOPE"
        id="canvas"
        :title="t('sprite.panel.canvas', { n: selectedFrame })"
        :min-width="200"
        :min-height="220"
      >
        <div class="sp-canvas-wrap">
          <PixelCanvas
            ref="canvasRef"
            class="sp-canvas-host"
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

      <!-- Tools — shared pixel toolbar -->
      <FloatPanel :scope="SCOPE" id="tools" :title="t('sprite.panel.tools')" :min-width="TOOLS_MIN_W" :min-height="TOOLS_MIN_H">
        <PixelToolbar
          v-model:tool="activeTool"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @undo="canvasRef?.undo()"
          @redo="canvasRef?.redo()"
        />
      </FloatPanel>

      <!-- Colors -->
      <FloatPanel :scope="SCOPE" id="colors" :title="t('sprite.panel.colors')" :min-width="160" :min-height="150">
        <p class="sp-pen-hint">{{ t('sprite.penHint') }}</p>
        <div class="sp-pens">
          <button
            v-for="pen in pens"
            :key="pen.index"
            class="sp-pen"
            :class="{ 'is-active': leftIndex === pen.index }"
            @click="leftIndex = pen.index"
          >
            <span class="sp-pen-chip" :style="{ background: pen.color }" />
            <span class="sp-pen-label">{{ pen.label }}</span>
          </button>
        </div>

        <!-- Individual colour picker: the one free, per-sprite colour (index 2).
             The two SHARED colours are fixed by the project palette (edit them in
             the Palette editor — there it affects ALL sprites, by design). -->
        <div class="sp-indiv">
          <span class="sp-indiv-label">{{ t('sprite.indivColor') }}</span>
          <div class="sp-swatches">
            <button
              v-for="c in C64_PALETTE"
              :key="c.index"
              class="sp-swatch"
              :class="{ 'is-sel': sprite.color === c.index }"
              :style="{ background: c.hex }"
              :title="t(c.i18nKey)"
              @click="pickIndivColor(c.index)"
            />
          </div>
        </div>
      </FloatPanel>
    </div>
  </div>
</template>

<style scoped>
.sprite {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bc-grad-night);
  overflow: hidden;
}

.sp-watermark {
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

/* ---- action strip ---- */
.sp-tabs {
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
.sp-title {
  font: 700 13px/1 var(--bc-font-display);
  color: var(--bc-text-100);
  letter-spacing: 0.02em;
}
.sp-tabs-spacer {
  flex: 1;
}
.sp-reset,
.sp-save {
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
.sp-reset {
  border-color: var(--bc-border-copper);
}
.sp-reset:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-glow-copper);
}
/* Light table active: arc-blue "on" state, mirrors the Tileset editor's toggle. */
.sp-reset.is-on {
  color: var(--bc-arc-200);
  border-color: var(--bc-arc-400);
  background: rgba(94, 196, 255, 0.08);
  box-shadow: var(--bc-glow-arc);
}
.sp-reset.is-on .ico {
  stroke: var(--bc-arc-300);
}
.sp-reset .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: var(--bc-copper-300);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sp-save:hover:not(:disabled) {
  color: var(--bc-text-100);
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.sp-save:disabled {
  opacity: 0.5;
  cursor: default;
}
.sp-save .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sp-save-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  transition: background 120ms ease;
}
.sp-save-dot.is-dirty {
  background: var(--bc-filament);
  box-shadow: 0 0 6px var(--bc-filament);
}
.sp-counter {
  font: 500 11px/1 var(--bc-font-mono);
  color: var(--bc-text-400);
  letter-spacing: 0.04em;
}
.sp-counter-val {
  color: var(--bc-arc-300);
}
/* Sprite-island footprint (SA6): mono like the counter; the value goes amber as this
   sprite nears the shared island ceiling, red if it alone exceeds it. */
.sp-island {
  font: 500 11px/1 var(--bc-font-mono);
  color: var(--bc-text-400);
  letter-spacing: 0.04em;
}
.sp-island-val {
  color: var(--bc-arc-300);
}
.sp-island.is-warn .sp-island-val {
  color: var(--bc-warn, #e0a000);
}
.sp-island.is-over,
.sp-island.is-over .sp-island-val {
  color: var(--bc-danger, #d04040);
}

/* ---- surface ---- */
.sp-surface {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* ---- frame strip ---- */
.sp-frames {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
  padding: 4px;
}
.sp-frame {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.sp-frame:hover {
  border-color: var(--bc-border-strong);
}
.sp-frame.is-sel {
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
/* 24×21 mini-preview of the frame */
.sp-frame-mini {
  flex: none;
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  grid-template-rows: repeat(21, 1fr);
  width: 48px;
  height: 42px;
  border-radius: 2px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
}
.sp-frame-mini i {
  display: block;
}
.sp-frame-no {
  font: 500 11px/1 var(--bc-font-mono);
  color: var(--bc-text-300);
}
.sp-frame-del {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 700 13px/1 var(--bc-font-sans);
  color: var(--bc-text-400);
  background: rgba(0, 0, 0, 0.4);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: all 100ms ease;
}
.sp-frame:hover .sp-frame-del {
  opacity: 1;
}
.sp-frame-del:hover {
  color: var(--bc-filament);
}
.sp-frame-add {
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  padding: 6px 8px;
  font: 600 12px/1 var(--bc-font-sans);
  color: var(--bc-text-300);
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed var(--bc-border-copper);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.sp-frame-add:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-glow-copper);
}
.sp-frame-add-plus {
  font-size: 16px;
  color: var(--bc-copper-300);
}

/* ---- canvas ----
   The sprite keeps its true 24:21 proportion regardless of panel shape (WYSIWYG):
   bind to height, derive width from aspect-ratio, cap both axes. The per-pixel aspect
   (hi-res 1:1 / MC 2:1) is handled inside <PixelCanvas>. */
.sp-canvas-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.sp-canvas-host {
  aspect-ratio: 24 / 21;
  height: 100%;
  width: auto;
  max-width: 100%;
  max-height: 100%;
}

/* ---- colours ---- */
.sp-pen-hint {
  margin: 0 0 var(--bc-space-2);
  font-size: 11px;
  color: var(--bc-text-400);
}
.sp-pens {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
}
.sp-pen {
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
.sp-pen:hover {
  border-color: var(--bc-border-strong);
}
.sp-pen.is-active {
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.sp-pen-chip {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--bc-radius-sm);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 0 0 2px rgba(0, 0, 0, 0.35);
}
.sp-pen-label {
  font: 500 12.5px/1 var(--bc-font-sans);
  color: var(--bc-text-200);
}

.sp-indiv {
  margin-top: var(--bc-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
}
.sp-indiv-label {
  font: 600 11px/1 var(--bc-font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bc-text-300);
}
.sp-swatches {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 3px;
}
.sp-swatch {
  aspect-ratio: 1;
  border: 1px solid var(--bc-line-700);
  border-radius: 3px;
  cursor: pointer;
  padding: 0;
}
.sp-swatch.is-sel {
  outline: 2px solid var(--bc-arc-blue);
  outline-offset: 1px;
  border-color: var(--bc-arc-blue);
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePaletteStore, C64_PALETTE } from '../stores/palette'
import { usePanelsStore } from '../stores/panels'
import { PixelEngine, type PixelIndex, type ToolId } from '../pixel-engine'
import FloatPanel from '../components/FloatPanel.vue'
import PixelToolbar from '../components/PixelToolbar.vue'

const { t } = useI18n()

/**
 * Image (bitmap) editor — BRONZE B2.T2a, FIRST visible slice (deliberately useless):
 * a paintable C64 Multicolor-bitmap canvas. It reuses the HEADLESS pixel engine for
 * data + tools + undo/redo, but renders to a real <canvas> instead of <PixelCanvas> —
 * the DOM-grid PixelCanvas draws one node per cell, which doesn't scale to a full
 * 160×200 screen (32 000 cells). What's NOT here yet, on purpose: saving (B2.T1 asset
 * format) and the per-cell colour-clash guard (the rest of B2.T2a). The 4 colours are
 * one GLOBAL palette for now, not the honest per-8×8-cell budget.
 */

const palette = usePaletteStore()
const panels = usePanelsStore()

const SCOPE = 'image'

// MC bitmap: 160×200 logical pixels (double-WIDE), so the display is 320×200 device
// pixels (each logical pixel = 2 columns). The canvas keeps that 8:5 shape; CSS scales
// it up with pixelated rendering so the C64 pixel stays crisp (WYSIWYG, Leitsatz §8).
const W = 160
const H = 200
const DISP_W = 320
const DISP_H = 200

// The shared headless engine (no Vue): a freehand drag becomes ONE undo step, and we
// get line/rect/fill for free. We render its snapshot ourselves after each change.
const engine = new PixelEngine(W, H)

const TOOLS_MIN_W = 120
const TOOLS_MIN_H = 230

panels.ensure(
  SCOPE,
  {
    canvas: { x: 24, y: 24, width: 660, height: 460 },
    tools: { x: 700, y: 24, width: 200, height: TOOLS_MIN_H },
    colors: { x: 700, y: 24 + TOOLS_MIN_H + 16, width: 200, height: 230 }
  },
  { tools: { minWidth: TOOLS_MIN_W, minHeight: TOOLS_MIN_H } }
)

const activeTool = ref<ToolId>('draw')
const canUndo = ref(false)
const canRedo = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// The 4 MC colour sources, same roles the MC-text palette uses (0=bg, 1/2=shared,
// 3=free). One GLOBAL palette for this first slice — the per-cell budget is later.
const bg = computed(() => palette.colorOf('background'))
const s1 = computed(() => palette.colorOf('shared1'))
const s2 = computed(() => palette.colorOf('shared2'))
const free = C64_PALETTE[1]

const pens = computed<{ index: PixelIndex; label: string; color: string }[]>(() => [
  { index: 0, label: t('image.pen.bg'), color: bg.value.hex },
  { index: 1, label: t('image.pen.s1'), color: s1.value.hex },
  { index: 2, label: t('image.pen.s2'), color: s2.value.hex },
  { index: 3, label: t('image.pen.free'), color: free.hex }
])
const leftIndex = ref<PixelIndex>(3)
const rightIndex: PixelIndex = 0 // background = DPaint erase

/** The 4 palette hexes as [r,g,b] triples, in index order, for the renderer. */
const rgbPalette = computed<[number, number, number][]>(() => [
  hexToRgb(bg.value.hex),
  hexToRgb(s1.value.hex),
  hexToRgb(s2.value.hex),
  hexToRgb(free.hex)
])

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Paint the engine's current grid into the canvas (each logical pixel = 2 columns). */
function render(): void {
  const cv = canvasRef.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx) return
  const snap = engine.grid.snapshot()
  const pal = rgbPalette.value
  const img = ctx.createImageData(DISP_W, DISP_H)
  const data = img.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pal[snap[y * W + x]] ?? pal[0]
      for (let dx = 0; dx < 2; dx++) {
        const o = (y * DISP_W + x * 2 + dx) * 4
        data[o] = r
        data[o + 1] = g
        data[o + 2] = b
        data[o + 3] = 255
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

function cellFromEvent(ev: PointerEvent): { x: number; y: number } | null {
  const cv = canvasRef.value
  if (!cv) return null
  const rect = cv.getBoundingClientRect()
  const x = Math.floor(((ev.clientX - rect.left) / rect.width) * W)
  const y = Math.floor(((ev.clientY - rect.top) / rect.height) * H)
  if (x < 0 || y < 0 || x >= W || y >= H) return null
  return { x, y }
}

function penFor(button: number): PixelIndex {
  return button === 2 ? rightIndex : leftIndex.value
}

let painting = false

function onPointerDown(ev: PointerEvent): void {
  const cell = cellFromEvent(ev)
  if (!cell) return
  ev.preventDefault()
  canvasRef.value?.setPointerCapture(ev.pointerId)
  painting = true
  engine.begin(activeTool.value, cell.x, cell.y, penFor(ev.button))
  render()
}

function onPointerMove(ev: PointerEvent): void {
  if (!painting) return
  const cell = cellFromEvent(ev)
  if (!cell) return
  engine.move(activeTool.value, cell.x, cell.y, penFor(ev.buttons & 2 ? 2 : 0))
  render()
}

function onPointerUp(): void {
  if (!painting) return
  painting = false
  engine.end()
  syncHistory()
}

function syncHistory(): void {
  canUndo.value = engine.canUndo
  canRedo.value = engine.canRedo
}

function undo(): void {
  engine.undo()
  render()
  syncHistory()
}
function redo(): void {
  engine.redo()
  render()
  syncHistory()
}

function resetLayout(): void {
  panels.reset(SCOPE)
}

// Re-render when the project palette changes (the colours are live).
watch(rgbPalette, render, { deep: true })
onMounted(render)
</script>

<template>
  <div class="img">
    <!-- Giant engraved watermark — identifies the editor; panels may cover it. -->
    <span class="img-watermark" aria-hidden="true">IMAGE</span>

    <div class="img-bar">
      <span class="bc-label">{{ t('view.image.title') }}</span>
      <span class="img-note">{{ t('image.preview') }}</span>
      <div class="img-bar-spacer" />
      <button class="img-reset" :title="t('tileset.resetLayoutTitle')" @click="resetLayout">
        <svg class="ico" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
        {{ t('tileset.resetLayout') }}
      </button>
    </div>

    <div class="img-surface">
      <!-- Leinwand 160×200 (canvas renderer) -->
      <FloatPanel :scope="SCOPE" id="canvas" :title="t('image.panel.canvas')" :min-width="280" :min-height="220">
        <div class="img-canvas-wrap">
          <canvas
            ref="canvasRef"
            class="img-canvas-host"
            :width="DISP_W"
            :height="DISP_H"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @contextmenu.prevent
          />
        </div>
      </FloatPanel>

      <!-- Werkzeug — shared pixel toolbar -->
      <FloatPanel :scope="SCOPE" id="tools" :title="t('image.panel.tools')" :min-width="TOOLS_MIN_W" :min-height="TOOLS_MIN_H">
        <PixelToolbar
          v-model:tool="activeTool"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @undo="undo"
          @redo="redo"
        />
      </FloatPanel>

      <!-- Farben -->
      <FloatPanel :scope="SCOPE" id="colors" :title="t('image.panel.colors')" :min-width="160" :min-height="150">
        <p class="img-pen-hint">{{ t('image.penHint') }}</p>
        <div class="img-pens">
          <button
            v-for="pen in pens"
            :key="pen.index"
            class="img-pen"
            :class="{ 'is-active': leftIndex === pen.index }"
            @click="leftIndex = pen.index"
          >
            <span class="img-pen-chip" :style="{ background: pen.color }" />
            <span class="img-pen-label">{{ pen.label }}</span>
          </button>
        </div>
      </FloatPanel>
    </div>
  </div>
</template>

<style scoped>
.img {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bc-grad-night);
  overflow: hidden;
}

.img-watermark {
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
  font-size: clamp(80px, min(18vw, 38vh), 300px);
  line-height: 0.9;
  letter-spacing: -0.03em;
  color: var(--bc-copper-300);
  opacity: 0.07;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.04);
}

.img-bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--bc-space-3);
  height: 40px;
  padding: 0 var(--bc-space-4);
  background: var(--bc-grad-plate);
  border-bottom: 1px solid var(--bc-border);
  box-shadow: var(--bc-bevel);
  flex: none;
}
.img-note {
  font: 500 11px/1.2 var(--bc-font-mono);
  color: var(--bc-text-400);
  letter-spacing: 0.02em;
}
.img-bar-spacer {
  flex: 1;
}
.img-reset {
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
.img-reset:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-glow-copper);
}
.img-reset .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: var(--bc-copper-300);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.img-surface {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.img-canvas-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 0;
}
/* The bitmap's true shape is 320×200 device pixels (8:5). Keep that aspect, scale to
   the smaller axis, and render pixelated so the C64 pixel never blurs. */
.img-canvas-host {
  aspect-ratio: 8 / 5;
  height: 100%;
  width: auto;
  max-width: 100%;
  max-height: 100%;
  image-rendering: pixelated;
  background: #000;
  border-radius: var(--bc-radius-sm);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
  cursor: crosshair;
  touch-action: none;
}

.img-pen-hint {
  margin: 0 0 var(--bc-space-2);
  font-size: 11px;
  color: var(--bc-text-400);
}
.img-pens {
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-2);
}
.img-pen {
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
.img-pen:hover {
  border-color: var(--bc-border-strong);
}
.img-pen.is-active {
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.img-pen-chip {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--bc-radius-sm);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 0 0 2px rgba(0, 0, 0, 0.35);
}
.img-pen-label {
  font: 500 12.5px/1 var(--bc-font-sans);
  color: var(--bc-text-200);
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { importImage, IMPORT_W, IMPORT_H, type DitherMode } from '../pixel-engine/imageImport'
import { C64_PALETTE } from '../stores/palette'

/**
 * The import knobs dialog (BRONZE B2.T2f) — after a picture is decoded to 160×200 RGBA,
 * this shows a LIVE C64 preview while the user dials brightness / contrast / saturation
 * and the dither kernel, then applies. The heavy work is the pure `importImage`; the
 * decoded RGBA is fixed, so re-running on a knob change is cheap (recomputed on the next
 * frame to coalesce slider drags). On apply we hand the finished result back to ImageView.
 */

const props = defineProps<{
  rgba: Uint8ClampedArray
  palRgb: readonly (readonly [number, number, number])[]
}>()

const emit = defineEmits<{
  apply: [result: { pixels: Uint8Array; background: number }]
  cancel: []
}>()

const { t } = useI18n()

// Knob state — neutral defaults (identity), Atkinson dither on (the good default).
type DitherChoice = 'off' | DitherMode
const opts = reactive({
  brightness: 0,
  contrast: 0,
  saturation: 1,
  dither: 'atkinson' as DitherChoice
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
const DISP_W = IMPORT_W * 2 // 320 — MC pixels are double-wide
const DISP_H = IMPORT_H // 200
const background = ref(0)

let last: { pixels: Uint8Array; background: number } | null = null
let raf = 0

/** Re-run the conversion with the current knobs and paint the preview. */
function recompute(): void {
  const result = importImage(props.rgba, props.palRgb, {
    dither: opts.dither !== 'off',
    ditherMode: opts.dither === 'off' ? undefined : opts.dither,
    brightness: opts.brightness,
    contrast: opts.contrast,
    saturation: opts.saturation
  })
  last = result
  background.value = result.background
  render(result.pixels)
}

/** Coalesce rapid knob changes into one recompute per animation frame. */
function scheduleRecompute(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    recompute()
  })
}

/** Paint a 160×200 index buffer onto the 320×200 preview canvas (each pixel = 2 columns). */
function render(pixels: Uint8Array): void {
  const cv = canvasRef.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx) return
  const img = ctx.createImageData(DISP_W, DISP_H)
  const data = img.data
  for (let y = 0; y < IMPORT_H; y++) {
    for (let x = 0; x < IMPORT_W; x++) {
      const [r, g, b] = props.palRgb[pixels[y * IMPORT_W + x]] ?? props.palRgb[0]
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

function reset(): void {
  opts.brightness = 0
  opts.contrast = 0
  opts.saturation = 1
  opts.dither = 'atkinson'
}

function apply(): void {
  if (last) emit('apply', last)
}

watch(opts, scheduleRecompute)
onMounted(recompute)
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="ii-scrim" @click.self="emit('cancel')" @keydown.esc="emit('cancel')">
    <div class="ii-card" role="dialog" aria-modal="true" :aria-label="t('image.importModal.title')">
      <span class="bc-label ii-title">{{ t('image.importModal.title') }}</span>

      <div class="ii-body">
        <!-- Live C64 preview -->
        <div class="ii-preview">
          <canvas ref="canvasRef" class="ii-canvas" :width="DISP_W" :height="DISP_H" />
        </div>

        <!-- Knobs -->
        <div class="ii-knobs">
          <label class="ii-knob">
            <span class="ii-knob-label">{{ t('image.importOpt.brightness') }}</span>
            <input v-model.number="opts.brightness" type="range" min="-1" max="1" step="0.02" />
          </label>
          <label class="ii-knob">
            <span class="ii-knob-label">{{ t('image.importOpt.contrast') }}</span>
            <input v-model.number="opts.contrast" type="range" min="-1" max="1" step="0.02" />
          </label>
          <label class="ii-knob">
            <span class="ii-knob-label">{{ t('image.importOpt.saturation') }}</span>
            <input v-model.number="opts.saturation" type="range" min="0" max="2" step="0.02" />
          </label>

          <span class="ii-knob-label ii-dither-label">{{ t('image.importOpt.dither') }}</span>
          <div class="ii-seg" role="group">
            <button class="ii-seg-btn" :class="{ 'is-on': opts.dither === 'atkinson' }" @click="opts.dither = 'atkinson'">
              {{ t('image.importOpt.atkinson') }}
            </button>
            <button class="ii-seg-btn" :class="{ 'is-on': opts.dither === 'floyd' }" @click="opts.dither = 'floyd'">
              {{ t('image.importOpt.floyd') }}
            </button>
            <button class="ii-seg-btn" :class="{ 'is-on': opts.dither === 'off' }" @click="opts.dither = 'off'">
              {{ t('image.importOpt.ditherOff') }}
            </button>
          </div>

          <div class="ii-bg-row">
            <span class="ii-knob-label">{{ t('image.importOpt.background') }}</span>
            <span class="ii-bg-swatch" :style="{ background: C64_PALETTE[background].hex }" />
            <span class="ii-bg-name">{{ t(C64_PALETTE[background].i18nKey) }}</span>
          </div>

          <button class="ii-reset" @click="reset">{{ t('image.importOpt.reset') }}</button>
        </div>
      </div>

      <footer class="ii-actions">
        <button class="tbtn" @click="emit('cancel')">{{ t('dialog.cancel') }}</button>
        <button class="tbtn tbtn-primary" @click="apply">{{ t('image.importOpt.apply') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ii-scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 15, 0.7);
}
.ii-card {
  display: flex;
  flex-direction: column;
  width: 720px;
  max-width: calc(100vw - 48px);
  padding: var(--bc-space-6);
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
}
.ii-title {
  display: block;
  margin-bottom: var(--bc-space-4);
}
.ii-body {
  display: flex;
  gap: var(--bc-space-5);
}
.ii-preview {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: #000;
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
  padding: 8px;
}
.ii-canvas {
  width: 100%;
  height: auto;
  aspect-ratio: 8 / 5;
  image-rendering: pixelated;
  border-radius: var(--bc-radius-sm);
}
.ii-knobs {
  flex: 0 0 240px;
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-3);
}
.ii-knob {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ii-knob-label {
  font: 600 11px/1 var(--bc-font-sans);
  letter-spacing: 0.02em;
  color: var(--bc-text-300);
}
.ii-knob input[type='range'] {
  width: 100%;
  accent-color: var(--bc-copper-300);
}
.ii-dither-label {
  margin-top: var(--bc-space-2);
}
.ii-seg {
  display: inline-flex;
  border: 1px solid var(--bc-border-copper);
  border-radius: var(--bc-radius-pill);
  overflow: hidden;
}
.ii-seg-btn {
  flex: 1;
  padding: 5px 8px;
  font: 600 11px/1 var(--bc-font-sans);
  color: var(--bc-text-300);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.ii-seg-btn.is-on {
  color: var(--bc-ink-900, #06121f);
  background: var(--bc-copper-300);
}
.ii-seg-btn:not(.is-on):hover {
  color: var(--bc-text-100);
}
.ii-bg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--bc-space-2);
}
.ii-bg-swatch {
  width: 18px;
  height: 18px;
  flex: none;
  border: 1px solid rgba(0, 0, 0, 0.5);
  border-radius: var(--bc-radius-sm);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
.ii-bg-name {
  font: 500 11px/1.2 var(--bc-font-sans);
  color: var(--bc-text-300);
}
.ii-reset {
  align-self: flex-start;
  margin-top: var(--bc-space-2);
  padding: 4px 12px;
  font: 600 11px/1 var(--bc-font-sans);
  color: var(--bc-copper-300);
  background: transparent;
  border: 1px solid var(--bc-border-copper);
  border-radius: var(--bc-radius-pill);
  cursor: pointer;
}
.ii-reset:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-glow-copper);
}
.ii-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--bc-space-2);
  margin-top: var(--bc-space-6);
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePaletteStore, C64_PALETTE } from '../stores/palette'
import { usePanelsStore } from '../stores/panels'
import { useImageStore } from '../stores/image'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { PixelEngine, type PixelIndex, type ToolId } from '../pixel-engine'
import {
  MAX_CELL_COLORS,
  cellOf,
  cellColors,
  countClashCells,
  reconcileCells,
  cellsInBox,
  type Cell
} from '../pixel-engine/imageCells'
import { importImage, IMPORT_W, IMPORT_H } from '../pixel-engine/imageImport'
import FloatPanel from '../components/FloatPanel.vue'
import PixelToolbar from '../components/PixelToolbar.vue'

const { t } = useI18n()

/**
 * Image (bitmap) editor — BRONZE B2.T2a, the per-cell COLOUR model (memory
 * breadcraft-imageeditor-color-clash). The canvas is a flat 16-colour-per-pixel
 * buffer (the shared headless engine's grid, holding values 0–15 instead of the
 * usual 0–3 index — the grid is index-agnostic). Two modes, per the 2026-06-28
 * decision (NEWBIE-FIRST):
 *   • FREE (default) — paint any of the 16 C64 colours, no clash check; feels like
 *     DPaint. The per-cell budget readout still shows where you've exceeded the
 *     C64 limit, so you LEARN the hardware without being blocked.
 *   • C64-TRUE — each 8×8 cell is forced to the honest budget (global background +
 *     3 cell-own colours). A fourth colour snaps to the nearest one the cell can
 *     still afford (Multipaint's intelligent adaptation), reconciled per stroke.
 *
 * Still a preview: saving comes with the B2.T1 image format. Rendering goes to a
 * real <canvas> (the DOM-grid PixelCanvas can't scale to 32 000 cells — B2.T2a
 * finding). Neighbour-recolour live-clash and zoom/overview are later polish.
 */

const palette = usePaletteStore()
const panels = usePanelsStore()
const image = useImageStore()
const project = useProjectStore()
const ui = useUiStore()

const SCOPE = 'image'

// MC bitmap: 160×200 logical pixels (double-WIDE), so the display is 320×200 device
// pixels (each logical pixel = 2 columns). The canvas keeps that 8:5 shape; CSS scales
// it up with pixelated rendering so the C64 pixel stays crisp (WYSIWYG, Leitsatz §8).
const W = 160
const H = 200
const DISP_W = 320
const DISP_H = 200
const CELLS_X = 40
const CELLS_Y = 25

// The shared headless engine (no Vue): a freehand drag becomes ONE undo step, and we
// get line/rect/fill for free. Its grid stores the raw 16-colour bitmap (0–15).
const engine = new PixelEngine(W, H)

const TOOLS_MIN_W = 120
const TOOLS_MIN_H = 230

panels.ensure(
  SCOPE,
  {
    canvas: { x: 24, y: 24, width: 660, height: 460 },
    tools: { x: 700, y: 24, width: 200, height: TOOLS_MIN_H },
    colors: { x: 700, y: 24 + TOOLS_MIN_H + 16, width: 210, height: 300 }
  },
  { tools: { minWidth: TOOLS_MIN_W, minHeight: TOOLS_MIN_H } }
)

const activeTool = ref<ToolId>('draw')
const canUndo = ref(false)
const canRedo = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// View transform — the MC pixel is tiny at fit, so the wheel zooms TOWARDS the
// cursor and middle-drag pans, the way pixel editors work. The canvas keeps its
// device size; the stage is scaled/translated in CSS (getBoundingClientRect stays
// truthful, so cellFromEvent needs no zoom maths). `base*` is the fit size.
const viewportRef = ref<HTMLDivElement | null>(null)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const baseW = ref(0)
const baseH = ref(0)
const ASPECT = 8 / 5
const MIN_ZOOM = 1
const MAX_ZOOM = 40

const stageStyle = computed(() => ({
  width: `${baseW.value}px`,
  height: `${baseH.value}px`,
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`
}))

/** Painting mode — FREE (all 16, no limit) or C64-TRUE (per-cell budget enforced). */
type PaintMode = 'free' | 'c64'
const mode = ref<PaintMode>('free')
const showGrid = ref(true)

/** The colour the left button paints (0–15). Right button always paints background. */
const activeColor = ref(1) // white — a visible default on the black start canvas

/** The ONE global background colour (shared, $D021) — the 4th, budget-free colour. */
const bgValue = computed(() => palette.background)

/** The 16 fixed C64 colours as [r,g,b], for the renderer + nearest-colour reconcile. */
const PAL_RGB = C64_PALETTE.map((c) => hexToRgb(c.hex))

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

// A revision counter so the hover budget readout recomputes after the (non-reactive)
// Uint8Array grid mutates or the hovered cell changes.
const rev = ref(0)
const hoverCell = ref<Cell | null>(null)
const hoverPixel = ref<{ x: number; y: number } | null>(null)
const clashCount = ref(0)

/**
 * A preview of the exact logical pixel the next click would paint, in the active
 * colour, so you can aim precisely. Positioned in VIEWPORT space (pan + zoom) so its
 * ring stays a crisp 1px at any zoom, instead of being magnified inside the stage.
 */
const cursorStyle = computed(() => {
  const p = hoverPixel.value
  if (!p || !baseW.value) return null
  const pw = (baseW.value / W) * zoom.value
  const ph = (baseH.value / H) * zoom.value
  return {
    left: `${panX.value + p.x * pw}px`,
    top: `${panY.value + p.y * ph}px`,
    width: `${pw}px`,
    height: `${ph}px`,
    background: C64_PALETTE[activeColor.value].hex
  }
})

/** The hovered cell's colour spend + whether it exceeds the C64 budget. */
const hoverBudget = computed(() => {
  void rev.value
  const h = hoverCell.value
  if (!h) return null
  const used = cellColors(engine.grid.snapshot(), W, h.col, h.row, bgValue.value)
  return { col: h.col, row: h.row, count: used.length, over: used.length > MAX_CELL_COLORS }
})

/** Paint the engine's current grid into the canvas (each logical pixel = 2 columns). */
function render(): void {
  const cv = canvasRef.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx) return
  const snap = engine.grid.snapshot()
  const img = ctx.createImageData(DISP_W, DISP_H)
  const data = img.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = PAL_RGB[snap[y * W + x]] ?? PAL_RGB[0]
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

// Values are C64 colours (0–15); the grid is index-agnostic so we hand them through
// the engine's PixelIndex-typed API unchanged (documented cast, breadcraft-pixel-engine).
function penFor(button: number): PixelIndex {
  return (button === 2 ? bgValue.value : activeColor.value) as PixelIndex
}

let painting = false
let panning = false
let panStartX = 0
let panStartY = 0
let panOriginX = 0
let panOriginY = 0
// Pixel bounding box of the in-progress stroke → the cells C64-true mode reconciles.
let sMinX = 0
let sMinY = 0
let sMaxX = 0
let sMaxY = 0

function trackBounds(x: number, y: number, reset = false): void {
  if (reset) {
    sMinX = sMaxX = x
    sMinY = sMaxY = y
    return
  }
  if (x < sMinX) sMinX = x
  else if (x > sMaxX) sMaxX = x
  if (y < sMinY) sMinY = y
  else if (y > sMaxY) sMaxY = y
}

function updateHover(cell: { x: number; y: number } | null): void {
  hoverPixel.value = cell // the exact pixel for the cursor preview (updates every move)
  const c = cell ? cellOf(cell.x, cell.y) : null
  const cur = hoverCell.value
  if (c && cur && c.col === cur.col && c.row === cur.row) return
  if (!c && !cur) return
  hoverCell.value = c
}

function onPointerDown(ev: PointerEvent): void {
  // Middle button pans, regardless of what's under the cursor.
  if (ev.button === 1) {
    ev.preventDefault()
    panning = true
    panStartX = ev.clientX
    panStartY = ev.clientY
    panOriginX = panX.value
    panOriginY = panY.value
    viewportRef.value?.setPointerCapture(ev.pointerId)
    return
  }
  const cell = cellFromEvent(ev)
  if (!cell) return
  ev.preventDefault()
  viewportRef.value?.setPointerCapture(ev.pointerId)
  painting = true
  trackBounds(cell.x, cell.y, true)
  engine.begin(activeTool.value, cell.x, cell.y, penFor(ev.button))
  render()
}

function onPointerMove(ev: PointerEvent): void {
  if (panning) {
    panX.value = panOriginX + (ev.clientX - panStartX)
    panY.value = panOriginY + (ev.clientY - panStartY)
    clampPan()
    return
  }
  const cell = cellFromEvent(ev)
  updateHover(cell)
  if (!painting || !cell) return
  trackBounds(cell.x, cell.y)
  engine.move(activeTool.value, cell.x, cell.y, penFor(ev.buttons & 2 ? 2 : 0))
  render()
}

function onPointerUp(): void {
  if (panning) {
    panning = false
    return
  }
  if (!painting) return
  painting = false
  // C64-true: fold the per-cell reconcile into the SAME stroke so paint + fix are
  // one undo step. FREE mode commits the raw colours untouched.
  if (mode.value === 'c64') {
    const snap = engine.grid.snapshot()
    const cells = cellsInBox(sMinX, sMinY, sMaxX, sMaxY, W, H)
    engine.amend(reconcileCells(snap, W, cells, bgValue.value, PAL_RGB))
  }
  engine.end()
  commitEdit()
}

/** Wheel zooms towards the cursor: the image point under the pointer stays put. */
function onWheel(ev: WheelEvent): void {
  const vp = viewportRef.value
  if (!vp) return
  const rect = vp.getBoundingClientRect()
  const cx = ev.clientX - rect.left
  const cy = ev.clientY - rect.top
  const z0 = zoom.value
  const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z0 * (ev.deltaY < 0 ? 1.2 : 1 / 1.2)))
  if (z1 === z0) return
  const k = z1 / z0
  panX.value = cx - (cx - panX.value) * k
  panY.value = cy - (cy - panY.value) * k
  zoom.value = z1
  clampPan()
}

/** Recompute the fit (zoom = 1) size from the viewport, keeping the 8:5 shape. */
function fitToViewport(): void {
  const vp = viewportRef.value
  if (!vp) return
  const w = vp.clientWidth
  const h = vp.clientHeight
  if (!w || !h) return
  if (w / h > ASPECT) {
    baseH.value = h
    baseW.value = h * ASPECT
  } else {
    baseW.value = w
    baseH.value = w / ASPECT
  }
  clampPan()
}

/** Keep the content from drifting away: centre it when smaller than the viewport,
 *  otherwise clamp so an edge never floats inside the frame. */
function clampPan(): void {
  const vp = viewportRef.value
  if (!vp) return
  const w = vp.clientWidth
  const h = vp.clientHeight
  const cw = baseW.value * zoom.value
  const ch = baseH.value * zoom.value
  panX.value = cw <= w ? (w - cw) / 2 : Math.min(0, Math.max(w - cw, panX.value))
  panY.value = ch <= h ? (h - ch) / 2 : Math.min(0, Math.max(h - ch, panY.value))
}

function resetZoom(): void {
  zoom.value = 1
  fitToViewport()
}

function afterMutation(): void {
  render()
  canUndo.value = engine.canUndo
  canRedo.value = engine.canRedo
  clashCount.value = countClashCells(engine.grid.snapshot(), W, H, bgValue.value)
  rev.value++
}

/** A user edit: refresh the view AND push the new canvas into the image store (marks
 *  it dirty, so Save / the build flush pick it up). Not used for the initial load. */
function commitEdit(): void {
  afterMutation()
  image.setPixels(engine.grid.snapshot())
}

function undo(): void {
  engine.undo()
  commitEdit()
}
function redo(): void {
  engine.redo()
  commitEdit()
}

function save(): void {
  void image.save()
}

/** Pull the store's canvas into the engine, resetting undo to a clean slate. Used on
 *  mount and whenever the store swaps the buffer from outside (open / switch / new). */
function reloadFromStore(): void {
  engine.load(image.pixels.slice())
  afterMutation()
}

/** New image: a fresh, UNSAVED scratch canvas (mirrors the sprite editor's sketch pad).
 *  Nothing hits disk until "Save as"; if the current image has unsaved edits we ask
 *  before discarding. newBlank() bumps the store's loadToken → the watcher reloads. */
async function newImage(): Promise<void> {
  if (image.dirty) {
    const ok = await ui.confirm({
      title: t('image.newTitle'),
      message: t('image.newDiscardWarn'),
      confirmLabel: t('image.newDiscardConfirm')
    })
    if (!ok) return
  }
  image.newBlank()
}

const fileInputRef = ref<HTMLInputElement | null>(null)

/** Kick off "Import picture": ask before discarding unsaved edits, then open the OS
 *  file picker. The actual conversion happens in onFilePicked when a file arrives. */
async function importPicture(): Promise<void> {
  if (image.dirty) {
    const ok = await ui.confirm({
      title: t('image.import'),
      message: t('image.importDiscardWarn'),
      confirmLabel: t('image.importDiscardConfirm')
    })
    if (!ok) return
  }
  fileInputRef.value?.click()
}

/**
 * Decode a picked photo/PNG and convert it to a real C64 picture. The IMPURE part
 * lives here: the file is decoded and cover-crop-resized to 160×200 on an offscreen
 * <canvas>; the pure importImage() then does the perceptual C64 colour work. The
 * chosen background becomes the project's shared $D021 (setSlot) so the editor and
 * the saved bytes agree — every cell is then C64-legal, no clash.
 */
async function onFilePicked(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // let the same file be re-picked later
  if (!file) return
  try {
    const rgba = await decodeToRgba(file)
    const { pixels, background } = importImage(rgba, PAL_RGB, { dither: true })
    palette.setSlot('background', background) // adopt the picture's shared colour
    engine.load(pixels.slice())
    afterMutation()
    image.setPixels(pixels)
    // Show the whole imported picture centred, not a leftover zoomed/panned view.
    // Reset pan explicitly and re-fit on the next frame (after layout has settled).
    zoom.value = 1
    panX.value = 0
    panY.value = 0
    requestAnimationFrame(() => fitToViewport())
  } catch {
    await ui.notify({ title: t('image.import'), message: t('image.importFailed') })
  }
}

/**
 * Decode the picked file, cover-crop it to 8:5, resize to 160×200, return RGBA.
 * Uses `createImageBitmap` (decodes the Blob straight from memory) rather than an
 * `<img src=blob:>` — the app's CSP allows `img-src 'self' data:` but not `blob:`,
 * and createImageBitmap sidesteps img-src entirely so the CSP stays tight.
 */
async function decodeToRgba(file: File): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(file)
  try {
    const cv = document.createElement('canvas')
    cv.width = IMPORT_W
    cv.height = IMPORT_H
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // Cover-crop the source to the C64 DISPLAY aspect, then squeeze it into the buffer.
    // The MC bitmap buffer is 160×200, but it's shown 320×200 (pixels are double-wide),
    // so we frame the source to 8:5 = 1.6 — NOT the 160/200 = 0.8 buffer ratio — and
    // draw it into 160×200 (the editor doubles the width back on screen).
    const target = (IMPORT_W * 2) / IMPORT_H // 320/200 = 1.6
    const w = bitmap.width
    const h = bitmap.height
    let sx = 0
    let sy = 0
    let sw = w
    let sh = h
    if (w / h > target) {
      sw = Math.round(h * target)
      sx = Math.round((w - sw) / 2)
    } else {
      sh = Math.round(w / target)
      sy = Math.round((h - sh) / 2)
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, IMPORT_W, IMPORT_H)
    return ctx.getImageData(0, 0, IMPORT_W, IMPORT_H).data
  } finally {
    bitmap.close()
  }
}

/** Save-As: pick folder + name in the project (`.image`), write the current canvas
 *  there and bind to it — the way you make a second, third, … room image. */
function saveAs(): void {
  void project.saveAssetAs('image', '.image', t('saveas.title.image'))
}

/** Switch mode; entering C64-true reconciles the WHOLE image legal in one undo step. */
function setMode(m: PaintMode): void {
  if (m === mode.value) return
  mode.value = m
  if (m !== 'c64') return
  const snap = engine.grid.snapshot()
  const all = cellsInBox(0, 0, W - 1, H - 1, W, H)
  const writes = reconcileCells(snap, W, all, bgValue.value, PAL_RGB)
  if (!writes.length) return
  engine.begin('draw', writes[0].x, writes[0].y, writes[0].value as PixelIndex)
  engine.amend(writes.slice(1))
  engine.end()
  commitEdit()
}

function pickColor(index: number): void {
  activeColor.value = index
}

function resetLayout(): void {
  panels.reset(SCOPE)
}

// Re-render / re-count when the project background changes (it's the budget's 4th
// colour and the erase colour). Existing painted pixels keep their own colours.
watch(bgValue, () => {
  clashCount.value = countClashCells(engine.grid.snapshot(), W, H, bgValue.value)
  rev.value++
})

let resizeObserver: ResizeObserver | null = null

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
  }
}

// Reload when the store swaps the buffer from outside (project open, explorer switch,
// New) — NOT on in-editor edits (those only bump the buffer via setPixels).
watch(() => image.loadToken, reloadFromStore)

onMounted(() => {
  // Load the project's image (loadProjectAssets filled the store on open; a blank
  // canvas is the project background). engine.load resets history to a clean slate.
  reloadFromStore()
  fitToViewport()
  if (viewportRef.value) {
    resizeObserver = new ResizeObserver(() => fitToViewport())
    resizeObserver.observe(viewportRef.value)
  }
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="img">
    <!-- Giant engraved watermark — identifies the editor; panels may cover it. -->
    <span class="img-watermark" aria-hidden="true">IMAGE</span>

    <div class="img-bar">
      <span class="bc-label">{{ t('view.image.title') }}</span>

      <!-- Painting mode: newbie-first FREE default, C64-true one click away. -->
      <div class="img-seg" role="group" :aria-label="t('image.mode.label')">
        <button
          class="img-seg-btn"
          :class="{ 'is-on': mode === 'free' }"
          :title="t('image.mode.freeHint')"
          @click="setMode('free')"
        >
          {{ t('image.mode.free') }}
        </button>
        <button
          class="img-seg-btn"
          :class="{ 'is-on': mode === 'c64' }"
          :title="t('image.mode.c64Hint')"
          @click="setMode('c64')"
        >
          {{ t('image.mode.c64') }}
        </button>
      </div>

      <button
        class="img-toggle"
        :class="{ 'is-on': showGrid }"
        :title="t('image.grid.hint')"
        @click="showGrid = !showGrid"
      >
        <svg class="ico" viewBox="0 0 24 24">
          <path d="M3 3h18v18H3z" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </svg>
        {{ t('image.grid.show') }}
      </button>

      <!-- Honest per-cell readout: hovered cell's colour spend + global clash count. -->
      <span v-if="hoverBudget" class="img-budget" :class="{ 'is-clash': hoverBudget.over }">
        {{ t('image.budget.cell', { col: hoverBudget.col, row: hoverBudget.row }) }} ·
        {{ t('image.budget.colors', { n: hoverBudget.count, max: MAX_CELL_COLORS }) }}
      </span>
      <span class="img-clash" :class="{ 'is-clash': clashCount > 0 }">
        {{ clashCount > 0 ? t('image.clash.some', { n: clashCount }) : t('image.clash.none') }}
      </span>

      <div class="img-bar-spacer" />
      <span class="img-note">{{ t('image.preview') }}</span>
      <button class="img-reset" :title="t('tileset.resetLayoutTitle')" @click="resetLayout">
        <svg class="ico" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
        {{ t('tileset.resetLayout') }}
      </button>
      <button class="img-reset" :title="t('image.newTitle')" @click="newImage">
        <svg class="ico" viewBox="0 0 24 24"><path d="M14 3v5h5M14 3l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M12 11v6M9 14h6" /></svg>
        {{ t('image.new') }}
      </button>
      <button class="img-reset" :title="t('image.importTitle')" @click="importPicture">
        <svg class="ico" viewBox="0 0 24 24"><path d="M21 15l-5-5L5 21" /><path d="M21 3H3v18h18V3z" /><circle cx="8.5" cy="8.5" r="1.5" /></svg>
        {{ t('image.import') }}
      </button>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="img-file-input"
        @change="onFilePicked"
      />
      <button class="img-reset" :title="t('saveas.title.image')" @click="saveAs">
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg>
        {{ t('saveas.save') }}
      </button>
      <button
        class="img-save"
        :disabled="!image.dirty"
        :title="image.dirty ? t('asset.unsaved') : t('asset.saved')"
        @click="save"
      >
        <span class="img-save-dot" :class="{ 'is-dirty': image.dirty }" />
        {{ t('asset.save') }}
      </button>
    </div>

    <div class="img-surface">
      <!-- Leinwand 160×200 (canvas renderer) + 8×8 cell overlay -->
      <FloatPanel :scope="SCOPE" id="canvas" :title="t('image.panel.canvas')" :min-width="280" :min-height="220">
        <div
          class="img-canvas-wrap"
          ref="viewportRef"
          :class="{ 'is-panning': panning }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointerleave="updateHover(null)"
          @wheel.prevent="onWheel"
          @contextmenu.prevent
        >
          <div class="img-stage" :style="stageStyle">
            <canvas ref="canvasRef" class="img-canvas-host" :width="DISP_W" :height="DISP_H" />
            <svg
              v-if="showGrid"
              class="img-grid"
              :viewBox="`0 0 ${CELLS_X} ${CELLS_Y}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line v-for="c in CELLS_X - 1" :key="'v' + c" :x1="c" :y1="0" :x2="c" :y2="CELLS_Y" />
              <line v-for="r in CELLS_Y - 1" :key="'h' + r" :x1="0" :y1="r" :x2="CELLS_X" :y2="r" />
            </svg>
          </div>
          <div v-if="cursorStyle" class="img-cursor" :style="cursorStyle" aria-hidden="true" />
          <button class="img-zoom" :title="t('image.zoom.reset')" @click="resetZoom">
            {{ Math.round(zoom * 100) }}%
          </button>
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

      <!-- Farben — the full 16-colour C64 picker + the shared background swatch -->
      <FloatPanel :scope="SCOPE" id="colors" :title="t('image.panel.colors')" :min-width="180" :min-height="200">
        <p class="img-pen-hint">{{ t('image.penHint') }}</p>
        <div class="img-board">
          <button
            v-for="color in C64_PALETTE"
            :key="color.index"
            class="img-swatch"
            :class="{ 'is-active': activeColor === color.index }"
            :style="{ background: color.hex }"
            :title="`${color.index} · ${t(color.i18nKey)}`"
            @click="pickColor(color.index)"
          />
        </div>
        <div class="img-bg-row">
          <span class="img-swatch is-bg" :style="{ background: C64_PALETTE[bgValue].hex }" />
          <span class="img-bg-label">{{ t('image.color.bg') }} · {{ t(C64_PALETTE[bgValue].i18nKey) }}</span>
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
.img-file-input {
  display: none;
}

/* Free / C64-true segmented toggle */
.img-seg {
  display: inline-flex;
  border: 1px solid var(--bc-border-copper);
  border-radius: var(--bc-radius-pill);
  overflow: hidden;
}
.img-seg-btn {
  padding: 4px 12px;
  font: 600 11px/1 var(--bc-font-sans);
  letter-spacing: 0.02em;
  color: var(--bc-text-300);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.img-seg-btn.is-on {
  color: var(--bc-ink-900, #06121f);
  background: var(--bc-copper-300);
}
.img-seg-btn:not(.is-on):hover {
  color: var(--bc-text-100);
}

.img-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  font: 600 11px/1 var(--bc-font-sans);
  color: var(--bc-text-300);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-pill);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.img-toggle.is-on {
  color: var(--bc-text-100);
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.img-toggle .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}

.img-budget {
  font: 600 11px/1 var(--bc-font-mono);
  color: var(--bc-text-300);
  padding: 4px 8px;
  border-radius: var(--bc-radius-sm);
  background: rgba(255, 255, 255, 0.03);
}
.img-budget.is-clash {
  color: #ffd7c2;
  background: rgba(220, 90, 40, 0.22);
}
.img-clash {
  font: 600 11px/1 var(--bc-font-sans);
  color: var(--bc-text-400);
}
.img-clash.is-clash {
  color: #ff9d6f;
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

.img-save {
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
.img-save:hover:not(:disabled) {
  color: var(--bc-text-100);
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.img-save:disabled {
  opacity: 0.5;
  cursor: default;
}
.img-save-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  transition: background 120ms ease;
}
.img-save-dot.is-dirty {
  background: var(--bc-filament);
  box-shadow: 0 0 6px var(--bc-filament);
}

.img-surface {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* The viewport clips the (zoomable, pannable) stage. Wheel zooms to the cursor,
   middle-drag pans — so the tiny MC pixel becomes reachable. */
.img-canvas-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #000;
  border-radius: var(--bc-radius-sm);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
  cursor: crosshair;
  touch-action: none;
}
.img-canvas-wrap.is-panning {
  cursor: grabbing;
}
/* The stage holds canvas + grid overlay in one box (JS sets size + transform) so
   the 8×8 lines sit exactly on the C64 cell boundaries at any zoom. */
.img-stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.img-canvas-host {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  background: #000;
}
/* Live preview of the pixel the next click paints, in the active colour. The double
   ring (dark inset + light outer) keeps it legible on any of the 16 colours. */
.img-cursor {
  position: absolute;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.85),
    0 0 0 1px rgba(255, 255, 255, 0.9);
}

.img-zoom {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 3px 9px;
  font: 600 11px/1 var(--bc-font-mono);
  color: var(--bc-text-200);
  background: rgba(6, 18, 31, 0.72);
  border: 1px solid var(--bc-border-copper);
  border-radius: var(--bc-radius-pill);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.img-zoom:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
}
.img-grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.img-grid line {
  stroke: rgba(120, 200, 255, 0.22);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.img-pen-hint {
  margin: 0 0 var(--bc-space-2);
  font-size: 11px;
  color: var(--bc-text-400);
}
.img-board {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.img-swatch {
  aspect-ratio: 1;
  border: 1px solid rgba(0, 0, 0, 0.4);
  border-radius: var(--bc-radius-sm);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  cursor: pointer;
  padding: 0;
  transition: transform 90ms ease;
}
.img-swatch:hover {
  transform: scale(1.08);
}
.img-swatch.is-active {
  outline: 2px solid var(--bc-arc-400);
  outline-offset: 1px;
  box-shadow: var(--bc-glow-arc);
}
.img-bg-row {
  display: flex;
  align-items: center;
  gap: var(--bc-space-2);
  margin-top: var(--bc-space-3);
}
.img-swatch.is-bg {
  width: 22px;
  height: 22px;
  aspect-ratio: auto;
  flex: none;
  cursor: default;
}
.img-bg-label {
  font: 500 11px/1.2 var(--bc-font-sans);
  color: var(--bc-text-300);
}
</style>

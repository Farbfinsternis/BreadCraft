<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePaletteStore, C64_PALETTE } from '../stores/palette'
import { usePanelsStore } from '../stores/panels'
import { useCharsetStore } from '../stores/charset'
import { useTilemapStore } from '../stores/tilemap'
import { useProjectStore } from '../stores/project'
import { MAP_W, MAP_H } from '../stores/assetIo'
import { drawChar } from '../pixel-engine/charsetRender'
import FloatPanel from '../components/FloatPanel.vue'

const { t } = useI18n()

/**
 * Tilemap editor (minimal, Phase 1) — paints the 40×25 graphics layer by stamping
 * a single TILE (a painted charset character) into cells. Renders to a real
 * <canvas> at the C64's native 320×200 (BREADCRAFT_IDE.md §3.0.1): no per-cell DOM,
 * only the changed cell is redrawn on paint → fast even on a full map. NOT pixel
 * painting (that's the PETSCII editor); no MetaTiles / META-layer yet.
 */

const palette = usePaletteStore()
const panels = usePanelsStore()
const charset = useCharsetStore()
const tilemap = useTilemapStore()
const project = useProjectStore()

const SCOPE = 'tilemap'

// Tiles render with the project's mode so MC charsets (4×8 double-pixel cells) draw
// correctly here too (M2.T1). Full MC map fidelity — per-cell Color-RAM colour
// instead of the fixed "free" sample — is M2.T2.
const isMC = computed(() => project.graphicsMode === 'TEXT_MULTICOLOR')

panels.ensure(SCOPE, {
  tiles: { x: 24, y: 24, width: 260, height: 320 },
  map: { x: 304, y: 24, width: 680, height: 460 },
  tools: { x: 24, y: 360, width: 260, height: 140 },
  colors: { x: 24, y: 512, width: 260, height: 150 }
})

const CHAR_PX = 8
const CANVAS_W = MAP_W * CHAR_PX // 320
const CANVAS_H = MAP_H * CHAR_PX // 200

// Index → hex for the 4 MC colour sources, same mapping the PETSCII editor uses
// (0=bg, 1=shared1, 2=shared2, 3=free). A painted tile renders identically here.
const indexPalette = computed<string[]>(() => [
  palette.colorOf('background').hex,
  palette.colorOf('shared1').hex,
  palette.colorOf('shared2').hex,
  C64_PALETTE[1].hex
])

const bg = computed(() => palette.colorOf('background'))

// The tiles available as brushes = the painted characters of the project charset.
// Char 0 is offered too (the "empty" tile = clear a cell).
const paintedTiles = computed<number[]>(() => {
  const used = [0]
  for (let i = 1; i < 256; i++) if (charset.isUsed(i)) used.push(i)
  return used
})
const selectedTile = ref(0)

// The Color-RAM colour the pen writes into each painted cell — the free 4th MC
// colour (the %11 bit-pair) per 8×8 cell (TILEMAP_EDITOR.md §4, only meaningful in
// multicolor). HARDWARE TRUTH: in multicolor-text mode this colour comes from the
// LOW THREE bits of Color-RAM, so only the first 8 C64 colours (0–7) can be the free
// colour — picking light grey is simply not on offer (the C64 would show its low-3-bit
// twin instead). We therefore offer exactly those 8 and never lie in the preview.
const MC_COLOR_COUNT = 8
const mcColors = C64_PALETTE.slice(0, MC_COLOR_COUNT)
const activeColor = ref(1) // white — a visible "not yet chosen" default within 0–7

/** Hex of a cell's Color-RAM colour, for rendering its tile's index-3 pixels. Masked
 *  to the low 3 bits so the editor shows EXACTLY what the C64 will (legacy maps may
 *  hold an 8–15 value from before this limit was enforced). */
function cellColorHex(col: number, row: number): string {
  return C64_PALETTE[tilemap.colorAt(col, row) & 7]?.hex ?? C64_PALETTE[1].hex
}

// ---- map canvas ----
const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null

// ---- hover preview (a transparent overlay canvas on top of the map) ----
// A separate canvas so the ghost never touches the committed map render — drawn
// on pointer move, cleared on leave. Shows the active tile half-transparent at the
// cell under the cursor, so you see WHERE a click will paint before committing.
const overlayRef = ref<HTMLCanvasElement | null>(null)
let octx: CanvasRenderingContext2D | null = null
let hoverIndex = -1 // row*MAP_W+col currently ghosted, or -1 when none

/** Draw one map cell (its tile's 8×8 char) at column/row. */
function drawCell(col: number, row: number): void {
  if (!ctx) return
  const tn = tilemap.tiles[row * MAP_W + col]
  drawChar(
    ctx,
    charset.chars[tn],
    col * CHAR_PX,
    row * CHAR_PX,
    1,
    indexPalette.value,
    isMC.value,
    cellColorHex(col, row)
  )
}

/** Redraw the whole 40×25 map (load / charset / palette change). */
function redrawAll(): void {
  if (!ctx) return
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) drawCell(col, row)
  }
}

// Coalesce rapid changes (a fast drag) into one redraw per animation frame.
let rafPending = false
const dirtyCells = new Set<number>()
let fullDirty = false
function scheduleDraw(full: boolean, cellIndex?: number): void {
  if (full) fullDirty = true
  else if (cellIndex !== undefined) dirtyCells.add(cellIndex)
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    if (fullDirty) {
      redrawAll()
    } else {
      for (const i of dirtyCells) drawCell(i % MAP_W, Math.floor(i / MAP_W))
    }
    fullDirty = false
    dirtyCells.clear()
  })
}

// ---- painting ----
let painting = false

function cellFromEvent(ev: PointerEvent): { col: number; row: number } | null {
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const col = Math.floor(((ev.clientX - rect.left) / rect.width) * MAP_W)
  const row = Math.floor(((ev.clientY - rect.top) / rect.height) * MAP_H)
  if (col < 0 || row < 0 || col >= MAP_W || row >= MAP_H) return null
  return { col, row }
}

/** Show the half-transparent active tile at (col,row) on the overlay (clearing any
 *  previous ghost). The preview uses the active Color-RAM colour, so it matches what
 *  a click will commit. No-op if the same cell is already ghosted. */
function showGhost(col: number, row: number): void {
  if (!octx) return
  const idx = row * MAP_W + col
  if (idx === hoverIndex) return
  clearGhost()
  hoverIndex = idx
  octx.save()
  octx.globalAlpha = 0.5
  const ramHex = C64_PALETTE[activeColor.value & 7]?.hex ?? C64_PALETTE[1].hex
  drawChar(octx, charset.chars[selectedTile.value], col * CHAR_PX, row * CHAR_PX, 1, indexPalette.value, isMC.value, ramHex)
  octx.restore()
}

/** Remove the current ghost from the overlay. */
function clearGhost(): void {
  if (!octx || hoverIndex < 0) return
  const col = hoverIndex % MAP_W
  const row = Math.floor(hoverIndex / MAP_W)
  octx.clearRect(col * CHAR_PX, row * CHAR_PX, CHAR_PX, CHAR_PX)
  hoverIndex = -1
}

function paintAt(ev: PointerEvent): void {
  const c = cellFromEvent(ev)
  if (!c) return
  const beforeTile = tilemap.tileAt(c.col, c.row)
  const beforeColor = tilemap.colorAt(c.col, c.row)
  tilemap.setTile(c.col, c.row, selectedTile.value, activeColor.value)
  // Redraw just THIS cell immediately (the fast path during a drag) — no full-map
  // repaint. setTile is a no-op if unchanged, so only draw when tile OR colour changed.
  if (beforeTile !== selectedTile.value || beforeColor !== activeColor.value) {
    scheduleDraw(false, c.row * MAP_W + c.col)
  }
}

function onPointerDown(ev: PointerEvent): void {
  ev.preventDefault()
  // Capture on the overlay (the element receiving the events) so a fast drag keeps
  // delivering moves even if the cursor briefly leaves the canvas.
  overlayRef.value?.setPointerCapture(ev.pointerId)
  painting = true
  paintAt(ev)
}
function onPointerMove(ev: PointerEvent): void {
  if (painting) paintAt(ev)
  const c = cellFromEvent(ev)
  if (c) showGhost(c.col, c.row)
  else clearGhost()
}
function onPointerUp(): void {
  painting = false
}
function onPointerLeave(): void {
  clearGhost()
}

// Single-cell paints redraw their own cell (paintAt → scheduleDraw(false, …)), so
// we deliberately do NOT watch `version` for a full repaint — that would repaint
// the whole map on every drag step. Instead we full-redraw only when the underlying
// data identity changes: a project load replaces tilemap.tiles with a NEW array
// (setTile mutates in place), and a charset/palette change recolours every tile.
watch(
  () => tilemap.tiles,
  () => scheduleDraw(true) // new array identity = a load → repaint all
)
watch(indexPalette, () => scheduleDraw(true))
watch(
  () => charset.chars,
  () => scheduleDraw(true),
  { deep: true }
)
// A changed tile/colour/palette makes any shown ghost stale → drop it; the next
// pointer move redraws it fresh.
watch([selectedTile, activeColor, indexPalette], () => clearGhost())

function initCanvas(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  ctx = canvas.getContext('2d')
  const overlay = overlayRef.value
  if (overlay) {
    overlay.width = CANVAS_W
    overlay.height = CANVAS_H
    octx = overlay.getContext('2d')
  }
  redrawAll()
}

onMounted(async () => {
  await nextTick()
  initCanvas()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerup', onPointerUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerup', onPointerUp)
})

// Counter: how many cells are non-empty (tile != 0).
const filledCount = computed(() => {
  void tilemap.version
  let n = 0
  for (let i = 0; i < MAP_W * MAP_H; i++) if (tilemap.tiles[i] !== 0) n++
  return n
})

function resetLayout(): void {
  panels.reset(SCOPE)
}

/** Save-As (P2.T0b): pick folder + name in the project, write the current map there. */
function saveAs(): void {
  void project.saveAssetAs('tilemap', '.tilemap', t('saveas.title.tilemap'))
}

// Ctrl/Cmd+S saves the tilemap (explicit save — no auto-save, ASSET_DOCUMENTS.md §2.5).
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void tilemap.save()
  }
}

// ---- tile palette mini-previews (small canvases) ----
const tileScale = 4 // 8×8 char → 32×32 preview
function paintTilePreview(canvas: HTMLCanvasElement | null, tn: number): void {
  if (!canvas) return
  const c = canvas.getContext('2d')
  if (!c) return
  // The brush preview shows index 3 in the active Color-RAM colour, so the swatch
  // matches what painting will stamp into a cell.
  const ramHex = C64_PALETTE[activeColor.value & 7]?.hex ?? C64_PALETTE[1].hex
  drawChar(c, charset.chars[tn], 0, 0, tileScale, indexPalette.value, isMC.value, ramHex)
}
/** Vue ref callback fan-out: each preview canvas paints itself when mounted. */
function tilePreviewRef(tn: number) {
  return (el: unknown): void => {
    paintTilePreview(el instanceof HTMLCanvasElement ? el : null, tn)
  }
}
// Repaint all visible previews when the charset/palette changes.
const previewVersion = ref(0)
watch([indexPalette, () => charset.chars, paintedTiles, activeColor], () => previewVersion.value++, {
  deep: true
})
</script>

<template>
  <div class="tmap">
    <span class="tm-watermark" aria-hidden="true">TILEMAP</span>

    <!-- toolbar chrome (same family as the PETSCII editor) -->
    <div class="tm-bar">
      <div class="tm-bar-spacer" />
      <button class="tm-reset" :title="t('tilemap.resetLayoutTitle')" @click="resetLayout">
        <svg class="ico" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
        {{ t('tilemap.resetLayout') }}
      </button>
      <button class="tm-reset" :title="t('saveas.title.tilemap')" @click="saveAs">
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg>
        {{ t('saveas.save') }}
      </button>
      <button
        class="tm-save"
        :disabled="!tilemap.dirty"
        :title="tilemap.dirty ? t('asset.unsaved') : t('asset.saved')"
        @click="tilemap.save()"
      >
        <span class="tm-save-dot" :class="{ 'is-dirty': tilemap.dirty }" />
        <svg class="ico" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
        {{ t('asset.save') }}
      </button>
      <span class="tm-counter" :title="t('tilemap.counterTitle')">
        <span class="tm-counter-val">{{ filledCount }}</span> {{ t('tilemap.counterSuffix') }}
      </span>
    </div>

    <div class="tm-surface">
      <!-- Kacheln (tile palette = painted charset characters) -->
      <FloatPanel :scope="SCOPE" id="tiles" :title="t('tilemap.panel.tiles')" :min-width="160" :min-height="140">
        <p class="tm-hint">{{ t('tilemap.tilesHint') }}</p>
        <div v-if="paintedTiles.length <= 1" class="tm-empty">{{ t('tilemap.noCharset') }}</div>
        <div v-else class="tm-tiles" :key="previewVersion">
          <button
            v-for="tn in paintedTiles"
            :key="tn"
            class="tm-tile"
            :class="{ 'is-sel': selectedTile === tn }"
            :style="{ background: bg.hex }"
            :title="t('tilemap.tile', { n: tn })"
            @click="selectedTile = tn"
          >
            <canvas :ref="tilePreviewRef(tn)" class="tm-tile-canvas" width="32" height="32" />
          </button>
        </div>
      </FloatPanel>

      <!-- Karte (40×25 canvas) -->
      <FloatPanel :scope="SCOPE" id="map" :title="t('tilemap.panel.map')" :min-width="300" :min-height="240">
        <div class="tm-map-wrap">
          <div class="tm-map-stack">
            <canvas ref="canvasRef" class="tm-map-canvas" />
            <!-- transparent hover-preview overlay; sits exactly on the map and takes
                 the pointer events (the map canvas underneath is purely the render) -->
            <canvas
              ref="overlayRef"
              class="tm-map-canvas tm-map-overlay"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerleave="onPointerLeave"
              @contextmenu.prevent
            />
          </div>
        </div>
      </FloatPanel>

      <!-- Werkzeug (Phase 1: only the single-tile pen) -->
      <FloatPanel :scope="SCOPE" id="tools" :title="t('tilemap.panel.tools')" :min-width="160" :min-height="100">
        <button class="tm-tool is-active" disabled>
          <svg class="ico" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /></svg>
          {{ t('tilemap.tool.draw') }}
        </button>
      </FloatPanel>

      <!-- Color-RAM: the free 4th MC colour painted per cell (multicolor only) -->
      <FloatPanel
        v-if="isMC"
        :scope="SCOPE"
        id="colors"
        :title="t('tilemap.panel.colorRam')"
        :min-width="180"
        :min-height="120"
      >
        <p class="tm-hint">{{ t('tilemap.colorRamHint') }}</p>
        <div class="tm-swatches">
          <button
            v-for="c in mcColors"
            :key="c.index"
            class="tm-swatch"
            :class="{ 'is-sel': activeColor === c.index }"
            :style="{ background: c.hex }"
            :title="t(c.i18nKey)"
            @click="activeColor = c.index"
          />
        </div>
      </FloatPanel>
    </div>
  </div>
</template>

<style scoped>
.tmap {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bc-grad-night);
  overflow: hidden;
}

.tm-watermark {
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
  font-size: clamp(80px, min(18vw, 36vh), 320px);
  line-height: 0.9;
  letter-spacing: -0.03em;
  color: var(--bc-copper-300);
  opacity: 0.07;
}

/* ---- toolbar ---- */
.tm-bar {
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
.tm-bar-spacer {
  flex: 1;
}
.tm-reset,
.tm-save {
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
.tm-reset {
  border-color: var(--bc-border-copper);
}
.tm-reset:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-copper-300);
  box-shadow: var(--bc-glow-copper);
}
.tm-reset .ico {
  stroke: var(--bc-copper-300);
}
.tm-save:hover:not(:disabled) {
  color: var(--bc-text-100);
  border-color: var(--bc-arc-400);
  box-shadow: var(--bc-glow-arc);
}
.tm-save:disabled {
  opacity: 0.5;
  cursor: default;
}
.tm-reset .ico,
.tm-save .ico {
  width: 13px;
  height: 13px;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tm-save .ico {
  stroke: currentColor;
}
.tm-save-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  transition: background 120ms ease;
}
.tm-save-dot.is-dirty {
  background: var(--bc-filament);
  box-shadow: 0 0 6px var(--bc-filament);
}
.tm-counter {
  font: 500 11px/1 var(--bc-font-mono);
  color: var(--bc-text-400);
  letter-spacing: 0.04em;
}
.tm-counter-val {
  color: var(--bc-arc-300);
}

/* ---- surface ---- */
.tm-surface {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.tm-hint {
  margin: 0 0 var(--bc-space-2);
  font-size: 11px;
  color: var(--bc-text-400);
}
.tm-empty {
  font-size: 12px;
  color: var(--bc-text-400);
  line-height: 1.5;
}

/* ---- tile palette ---- */
.tm-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, 32px);
  gap: 4px;
}
.tm-tile {
  position: relative;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.4);
  border-radius: 2px;
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow 100ms ease;
}
.tm-tile:hover {
  box-shadow: 0 0 0 1px var(--bc-arc-300);
}
.tm-tile.is-sel {
  box-shadow: 0 0 0 2px var(--bc-arc-400), 0 0 8px rgba(94, 196, 255, 0.6);
  z-index: 1;
}
.tm-tile-canvas {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}

/* ---- map canvas ---- */
.tm-map-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 0;
}
/* The stack shrinks to the (auto-sized) map canvas so the overlay can sit exactly
   on top of it, same scaled rect. */
.tm-map-stack {
  position: relative;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 320 / 200;
}
/* The canvas is 320×200 internally (the real C64 picture); CSS scales it to fit
   the panel while keeping the 8:5 aspect, and `pixelated` keeps tile edges crisp. */
.tm-map-canvas {
  display: block;
  width: 100%;
  height: 100%;
  aspect-ratio: 320 / 200;
  image-rendering: pixelated;
  background: #000;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
/* The hover-preview overlay lies on top of the map, transparent, same size. */
.tm-map-overlay {
  position: absolute;
  inset: 0;
  background: transparent;
  box-shadow: none;
}

/* ---- tools ---- */
.tm-tool {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  font: 600 12px/1 var(--bc-font-sans);
  color: var(--bc-text-100);
  background: rgba(94, 196, 255, 0.08);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-pill);
  box-shadow: var(--bc-glow-arc);
  cursor: default;
}
.tm-tool .ico {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--bc-arc-300);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---- Color-RAM swatch grid ---- */
.tm-swatches {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.tm-swatch {
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.4);
  border-radius: var(--bc-radius-sm);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition: box-shadow 100ms ease;
}
.tm-swatch:hover {
  box-shadow: 0 0 0 1px var(--bc-arc-300);
}
.tm-swatch.is-sel {
  box-shadow: 0 0 0 2px var(--bc-arc-400), 0 0 8px rgba(94, 196, 255, 0.6);
}
</style>

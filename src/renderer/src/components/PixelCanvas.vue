<script setup lang="ts">
/**
 * <PixelCanvas> — renders a PixelGrid and turns pointer drags into engine strokes
 * (memory breadcraft-pixel-engine, PETSCII_EDITOR.md §8.2). This is the ONE place
 * that knows `pixelAspect` (1 = hi-res 1:1, 2 = multicolor double-wide 2:1) — the
 * WYSIWYG carrier (Leitsatz §8: what you paint must look like the C64).
 *
 * It OWNS a PixelEngine instance so the editor shell stays thin: the shell feeds
 * cells/palette/tool and listens for `update` (new cell data) — it never touches
 * the engine API directly. DPaint mouse model: left button paints `leftIndex`,
 * right button paints `rightIndex`.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { PixelEngine, type PixelIndex, type ToolId } from '@renderer/pixel-engine'

const props = defineProps<{
  width: number
  height: number
  /** 1 = hi-res (square cells), 2 = multicolor (double-wide cells). */
  pixelAspect: number
  /** Row-major grid cells (values 0–3); length must be width*height. */
  cells: Uint8Array
  /** Index → CSS colour, 4 entries (0..3). */
  palette: string[]
  tool: ToolId
  /** Index painted with the left mouse button (the active pen). */
  leftIndex: PixelIndex
  /** Index painted with the right mouse button (DPaint: usually background). */
  rightIndex: PixelIndex
  /** Font-Linse ghost (S9.T3): 64 row-major booleans (8×8) drawn as a white wash
   *  ON TOP of the paint grid, never occluded — so a tile sitting on a letter slot
   *  is visible. null/undefined = no ghost. Always 8×8 (the glyph's hi-res shape),
   *  independent of the paint grid's width (4 in MC, 8 in hi-res). */
  ghost?: ReadonlyArray<boolean> | null
  /** Light table (onion skin): the PREVIOUS tile's row-major cells (same length as
   *  `cells`, values 0–3). Drawn as a faint REAL-colour ghost only in THIS tile's
   *  background cells (idx 0), BEHIND the paint — so real pixels (1–3) occlude it.
   *  Opposite of `ghost` (which sits on top). null/undefined = off. The shell picks
   *  the previous tile (slot N−1); the canvas knows nothing about animations. */
  onion?: Uint8Array | null
  /** Read-only: render the grid but ignore paint strokes (no engine mutation, no
   *  `update`). Used for the reserved Hires font slots 0–63, which the MC editor must
   *  not paint — they are shaped in the Hires Font editor (MIXED_MODE_FONT_PLAN F3). */
  readonly?: boolean
}>()

const emit = defineEmits<{
  /** Fired after every stroke frame with the full, current cell data. */
  (e: 'update', cells: Uint8Array): void
  /** Fired when undo/redo availability changes, so the shell can enable buttons. */
  (e: 'history', state: { canUndo: boolean; canRedo: boolean }): void
}>()

// The engine is an imperative object, NOT reactive state — Vue must not try to
// wrap its internals. It's a plain (re-assignable) variable; the render state
// below is what drives the template.
let engine = new PixelEngine(props.width, props.height, props.cells.slice())

// Render state: a shallowRef snapshot we refresh AFTER every engine mutation.
// The engine mutates its grid in place (Vue can't see that), so we explicitly
// push a fresh snapshot here whenever something changes — this is what makes
// painting actually appear on screen.
const view = shallowRef<Uint8Array>(engine.grid.snapshot())

function syncView(): void {
  view.value = engine.grid.snapshot()
}

watch(
  () => [props.width, props.height] as const,
  ([w, h]) => {
    engine = new PixelEngine(w, h, props.cells.slice())
    syncView()
    emitHistory()
  }
)

// When the parent swaps in different cells (e.g. a new selected character), load
// them. The content guard stops our own `update` echoes from looping back in and
// wiping the undo history mid-stroke.
watch(
  () => props.cells,
  (next) => {
    if (!sameCells(engine.grid.snapshot(), next)) {
      engine.load(next.slice())
      syncView()
      emitHistory()
    }
  }
)

const cols = computed(() => props.width)
// Aspect carrier: a hi-res cell is square; an MC cell is twice as wide. We render
// with a fixed column count and let the cell's aspect-ratio do the stretching, so
// the on-screen pixel matches the C64's pixel shape exactly.
const cellAspect = computed(() => `${props.pixelAspect} / 1`)

let painting = false

// Hover preview: the cell index under the cursor (-1 = none). The active pen colour
// is shown half-transparent over that cell's real colour, so you see what the next
// click paints — without touching the pixel data (PETSCII counterpart of the tilemap
// ghost). The right mouse button erases (rightIndex), so while a right-drag is held
// the preview shows that pen instead.
const hoverCell = ref(-1)

function cellFromEvent(ev: PointerEvent): { x: number; y: number } | null {
  const host = ev.currentTarget as HTMLElement
  const rect = host.getBoundingClientRect()
  const fx = (ev.clientX - rect.left) / rect.width
  const fy = (ev.clientY - rect.top) / rect.height
  const x = Math.floor(fx * props.width)
  const y = Math.floor(fy * props.height)
  if (x < 0 || y < 0 || x >= props.width || y >= props.height) return null
  return { x, y }
}

function penFor(button: number): PixelIndex {
  // button 2 = right → rightIndex (DPaint erase-with-bg); anything else → left.
  return button === 2 ? props.rightIndex : props.leftIndex
}

function onPointerDown(ev: PointerEvent): void {
  if (props.readonly) return
  const cell = cellFromEvent(ev)
  if (!cell) return
  ev.preventDefault()
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  painting = true
  engine.begin(props.tool, cell.x, cell.y, penFor(ev.button))
  syncView()
  pushUpdate()
}

function onPointerMove(ev: PointerEvent): void {
  const cell = cellFromEvent(ev)
  hoverCell.value = cell ? cell.y * props.width + cell.x : -1
  if (!painting) return
  if (!cell) return
  engine.move(props.tool, cell.x, cell.y, penFor(ev.buttons & 2 ? 2 : 0))
  syncView()
  pushUpdate()
}

function onPointerUp(): void {
  if (!painting) return
  painting = false
  engine.end()
  emitHistory()
}

function onPointerLeave(): void {
  hoverCell.value = -1
  onPointerUp()
}

/** The active pen colour as a CSS rgba with 50% alpha, for the hover ghost. The pen
 *  is leftIndex (the left-button colour — the common case for the preview). */
const ghostColor = computed(() => {
  const hex = props.palette[props.leftIndex] ?? props.palette[0] ?? '#000'
  return hexToRgba(hex, 0.5)
})

/** Onion-skin opacity: the previous tile shows clearly but reads as a ghost, never
 *  mistaken for a real pixel. Over the cell's true background colour. */
const ONION_ALPHA = 0.5

/** Light table is on and matches the grid (same mode ⇒ same length as the view). */
const onionActive = computed(
  () => !!props.onion && props.onion.length === view.value.length
)

/** CSS background for one paint cell. Hover preview wins (shows the pen you're about
 *  to drop). Otherwise, when the light table is on and this cell is background (idx 0),
 *  the previous tile's pixel shows through as a faint colour ghost BEHIND — so real
 *  pixels (idx 1–3) naturally occlude it. Else just the cell's own colour. */
function bgFor(idx: number, i: number): string {
  const base = props.palette[idx] ?? props.palette[0]
  if (i === hoverCell.value) {
    return `linear-gradient(${ghostColor.value}, ${ghostColor.value}), ${base}`
  }
  if (onionActive.value && idx === 0) {
    const o = props.onion![i]
    if (o !== 0) {
      const c = hexToRgba(props.palette[o] ?? base, ONION_ALPHA)
      return `linear-gradient(${c}, ${c}), ${base}`
    }
  }
  return base
}

/** A `#rgb`/`#rrggbb` hex to an `rgba(…)` string at the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function undo(): void {
  engine.undo()
  syncView()
  pushUpdate()
  emitHistory()
}
function redo(): void {
  engine.redo()
  syncView()
  pushUpdate()
  emitHistory()
}
defineExpose({ undo, redo })

function pushUpdate(): void {
  emit('update', engine.grid.snapshot())
}
function emitHistory(): void {
  emit('history', { canUndo: engine.canUndo, canRedo: engine.canRedo })
}

function sameCells(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
</script>

<template>
  <div
    class="pixel-canvas"
    :style="{ '--cols': cols, '--cell-aspect': cellAspect }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerLeave"
    @contextmenu.prevent
  >
    <i
      v-for="(idx, i) in view"
      :key="i"
      class="pc-px"
      :class="{ 'is-hover': i === hoverCell }"
      :style="{ background: bgFor(idx, i) }"
    />
    <!-- Font-Linse ghost overlay (S9.T3): 8×8 white wash on top, never occluded. -->
    <div v-if="ghost" class="pc-ghost" aria-hidden="true">
      <i v-for="(on, gi) in ghost" :key="gi" :class="{ 'is-on': on }" />
    </div>
  </div>
</template>

<style scoped>
.pixel-canvas {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 1px;
  width: 100%;
  height: 100%;
  padding: 4px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: var(--bc-radius-sm);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
/* Ghost overlay: an 8×8 grid filling the same inner area as the paint grid (inset by
   the 4px padding), drawn ON TOP. Filled glyph pixels are white at 30% opacity (the
   user-chosen style); never blocks pointer events. */
.pc-ghost {
  position: absolute;
  inset: 4px;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  pointer-events: none;
}
.pc-ghost i.is-on {
  background: rgba(255, 255, 255, 0.3);
}
.pc-px {
  /* The aspect carrier: square in hi-res, double-wide in multicolor. */
  aspect-ratio: var(--cell-aspect);
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}
/* Hover preview: a faint ring so the ghosted cell reads even when the pen colour is
   close to the cell's current colour. */
.pc-px.is-hover {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}
</style>

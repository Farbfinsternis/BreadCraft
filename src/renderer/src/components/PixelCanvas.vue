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
  if (!painting) return
  const cell = cellFromEvent(ev)
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
    @pointerleave="onPointerUp"
    @contextmenu.prevent
  >
    <i
      v-for="(idx, i) in view"
      :key="i"
      class="pc-px"
      :style="{ background: palette[idx] ?? palette[0] }"
    />
  </div>
</template>

<style scoped>
.pixel-canvas {
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
.pc-px {
  /* The aspect carrier: square in hi-res, double-wide in multicolor. */
  aspect-ratio: var(--cell-aspect);
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}
</style>

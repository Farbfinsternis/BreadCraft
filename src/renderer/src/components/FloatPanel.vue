<script setup lang="ts">
import { computed } from 'vue'
import { usePanelsStore } from '../stores/panels'

/**
 * A free-floating, draggable, resizable panel — the DPaint-style toolbox window.
 * Geometry lives in the panels store (persisted), keyed by scope+id. Reusable by
 * every pixel editor. The parent must be `position: relative` and is the bounds
 * within which the panel may be dragged.
 */
const props = defineProps<{
  scope: string
  id: string
  title: string
  minWidth?: number
  minHeight?: number
}>()

const panels = usePanelsStore()
const minW = computed(() => props.minWidth ?? 160)
const minH = computed(() => props.minHeight ?? 120)

const rect = computed(() => panels.rect(props.scope, props.id))

const style = computed(() => {
  const r = rect.value
  if (!r) return { display: 'none' }
  return {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    zIndex: r.z
  }
})

function parentBounds(el: HTMLElement): DOMRect {
  const parent = el.offsetParent as HTMLElement | null
  return (parent ?? el).getBoundingClientRect()
}

function onRaise(): void {
  panels.raise(props.scope, props.id)
}

function startDrag(ev: PointerEvent): void {
  const r = rect.value
  if (!r) return
  onRaise()
  const panelEl = (ev.currentTarget as HTMLElement).closest('.float-panel') as HTMLElement
  const bounds = parentBounds(panelEl)
  const startX = ev.clientX
  const startY = ev.clientY
  const origX = r.x
  const origY = r.y

  function onMove(e: PointerEvent): void {
    let nx = origX + (e.clientX - startX)
    let ny = origY + (e.clientY - startY)
    // keep the panel inside the parent (leave the title bar reachable)
    nx = Math.max(0, Math.min(nx, bounds.width - r!.width))
    ny = Math.max(0, Math.min(ny, bounds.height - r!.height))
    panels.move(props.scope, props.id, nx, ny)
  }
  function onUp(): void {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function startResize(ev: PointerEvent): void {
  const r = rect.value
  if (!r) return
  ev.stopPropagation()
  onRaise()
  const panelEl = (ev.currentTarget as HTMLElement).closest('.float-panel') as HTMLElement
  const bounds = parentBounds(panelEl)
  const startX = ev.clientX
  const startY = ev.clientY
  const origW = r.width
  const origH = r.height

  function onMove(e: PointerEvent): void {
    let nw = origW + (e.clientX - startX)
    let nh = origH + (e.clientY - startY)
    nw = Math.max(minW.value, Math.min(nw, bounds.width - r!.x))
    nh = Math.max(minH.value, Math.min(nh, bounds.height - r!.y))
    panels.resize(props.scope, props.id, nw, nh)
  }
  function onUp(): void {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <section v-if="rect" class="float-panel" :style="style" @pointerdown="onRaise">
    <header class="fp-bar" @pointerdown="startDrag">
      <span class="bc-label fp-title">{{ title }}</span>
      <span class="fp-grip" aria-hidden="true">
        <i /><i /><i />
      </span>
    </header>
    <div class="fp-body">
      <slot />
    </div>
    <span class="fp-resize" aria-hidden="true" @pointerdown="startResize">
      <svg viewBox="0 0 12 12"><path d="M11 5L5 11M11 9l-2 2" /></svg>
    </span>
  </section>
</template>

<style scoped>
.float-panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-lg);
  box-shadow: var(--bc-bevel), var(--bc-shadow-3);
  overflow: hidden;
}

/* draggable title bar — copper plaque look */
.fp-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bc-space-2);
  height: 28px;
  padding: 0 var(--bc-space-3);
  background: linear-gradient(180deg, rgba(94, 196, 255, 0.06), transparent);
  border-bottom: 1px solid var(--bc-border);
  cursor: grab;
  user-select: none;
  flex: none;
}
.fp-bar:active {
  cursor: grabbing;
}
.fp-title {
  color: var(--bc-copper-300);
  pointer-events: none;
}

/* little 3-dot drag affordance */
.fp-grip {
  display: flex;
  gap: 2px;
  pointer-events: none;
}
.fp-grip i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--bc-text-500);
}

.fp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--bc-space-3);
}

/* resize grip, bottom-right */
.fp-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 3px;
  cursor: nwse-resize;
  color: var(--bc-text-500);
  transition: color 120ms ease;
}
.fp-resize:hover {
  color: var(--bc-arc-300);
}
.fp-resize svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}
</style>

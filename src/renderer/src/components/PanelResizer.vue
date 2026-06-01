<script setup lang="ts">
import { useUiStore, type CollapsiblePanel } from '@renderer/stores/ui'

const props = defineProps<{
  panel: CollapsiblePanel
  /** e = grow rightward edge, w = grow leftward edge, n = grow upward edge */
  dir: 'e' | 'w' | 'n'
}>()

const ui = useUiStore()

function onPointerDown(event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startY = event.clientY
  const startSize = ui.sizes[props.panel]

  document.body.style.userSelect = 'none'
  document.body.style.cursor = props.dir === 'n' ? 'row-resize' : 'col-resize'

  function onMove(e: PointerEvent): void {
    let next = startSize
    if (props.dir === 'e') next = startSize + (e.clientX - startX)
    else if (props.dir === 'w') next = startSize - (e.clientX - startX)
    else next = startSize - (e.clientY - startY) // n: drag up = taller console
    ui.setSize(props.panel, next)
  }

  function onUp(): void {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <div :class="['resizer', `resizer-${dir}`]" @pointerdown="onPointerDown" />
</template>

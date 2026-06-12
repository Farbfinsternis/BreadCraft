<script setup lang="ts">
import { ref } from 'vue'
import type { TreeNode } from '@shared/ipc'

/**
 * One node in the project file tree (P2.T0b) — a folder (collapsible) or a file.
 * Recursive: a folder renders <ExplorerNode> for each child. Folders toggle open;
 * files emit `open` (the parent routes by extension). Depth drives the indent.
 */
const props = defineProps<{
  node: TreeNode
  depth: number
  activeRel: string
}>()

const emit = defineEmits<{
  (e: 'open', node: TreeNode): void
}>()

const open = ref(true) // folders start expanded (shallow projects)

function onClick(): void {
  if (props.node.kind === 'dir') open.value = !open.value
  else emit('open', props.node)
}

/** A small type hint per file extension (for the icon tint / title). */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1) : ''
}
</script>

<template>
  <div
    class="ex-row"
    :class="{ 'is-dir': node.kind === 'dir', 'is-active': node.kind === 'file' && node.rel === activeRel }"
    :style="{ paddingLeft: `${4 + depth * 14}px` }"
    :title="node.rel"
    @click="onClick"
  >
    <!-- folder twisty -->
    <svg v-if="node.kind === 'dir'" class="ex-ico ex-tw" :class="{ open }" viewBox="0 0 24 24">
      <path d="m9 18 6-6-6-6" />
    </svg>
    <!-- folder / file icon -->
    <svg v-if="node.kind === 'dir'" class="ex-ico" viewBox="0 0 24 24">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
    <svg v-else class="ex-ico" :class="`ex-${extOf(node.name)}`" viewBox="0 0 24 24">
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    </svg>
    <span class="ex-name">{{ node.name }}</span>
  </div>

  <template v-if="node.kind === 'dir' && open && node.children">
    <ExplorerNode
      v-for="child in node.children"
      :key="child.rel"
      :node="child"
      :depth="depth + 1"
      :active-rel="activeRel"
      @open="(n) => emit('open', n)"
    />
  </template>
</template>

<style scoped>
.ex-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding-right: 6px;
  cursor: pointer;
  border-radius: var(--bc-radius-sm);
  color: var(--bc-text-300);
  user-select: none;
}
.ex-row:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--bc-text-100);
}
.ex-row.is-active {
  background: rgba(94, 196, 255, 0.1);
  color: var(--bc-text-100);
  box-shadow: inset 2px 0 0 var(--bc-arc-400);
}
.ex-ico {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ex-tw {
  width: 12px;
  height: 12px;
  transition: transform 120ms ease;
  stroke: var(--bc-text-400);
}
.ex-tw.open {
  transform: rotate(90deg);
}
/* file-type tints */
.ex-sprite {
  stroke: var(--bc-arc-300);
}
.ex-petscii {
  stroke: var(--bc-copper-300);
}
.ex-tilemap {
  stroke: var(--bc-filament);
}
.ex-crumb {
  stroke: var(--bc-text-300);
}
.ex-name {
  font: 500 12.5px/1 var(--bc-font-sans);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

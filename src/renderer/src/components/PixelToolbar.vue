<script setup lang="ts">
/**
 * <PixelToolbar> — the shared tool button strip for every pixel editor (memory
 * breadcraft-pixel-engine, PETSCII_EDITOR.md §8.2). Pure UI: it owns the tool
 * icons + styling in ONE place so PETSCII/Sprite/Bitmap look identical. Drives
 * `v-model:tool` and emits undo/redo (the engine lives in <PixelCanvas>).
 *
 * Tools may have VARIANTS (Aseprite-style split button): the rectangle tool is
 * outline OR filled, picked from a little flyout on the button's caret. The
 * button itself activates the last-chosen variant; its icon reflects that choice.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ToolId } from '@renderer/pixel-engine'

const { t } = useI18n()

const props = defineProps<{
  tool: ToolId
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  (e: 'update:tool', tool: ToolId): void
  (e: 'undo'): void
  (e: 'redo'): void
}>()

interface ToolVariant {
  key: ToolId
  labelKey: string
  path: string
  /** When true, the icon's shape is solid-filled (e.g. filled rectangle). */
  filled?: boolean
}
interface ToolDef {
  /** Stable id for the slot (a tool with variants groups them under this). */
  id: string
  /** The variants; a single-entry array means a plain button (no flyout). */
  variants: ToolVariant[]
}

const RECT_PATH = 'M4 5h16v14H4z'

const toolDefs: ToolDef[] = [
  {
    id: 'draw',
    variants: [
      {
        key: 'draw',
        labelKey: 'tileset.tool.draw',
        path: 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'
      }
    ]
  },
  { id: 'line', variants: [{ key: 'line', labelKey: 'tileset.tool.line', path: 'M5 19L19 5' }] },
  {
    id: 'rect',
    variants: [
      { key: 'rect', labelKey: 'tileset.tool.rectOutline', path: RECT_PATH },
      { key: 'rectFill', labelKey: 'tileset.tool.rectFill', path: RECT_PATH, filled: true }
    ]
  },
  {
    id: 'fill',
    variants: [
      {
        key: 'fill',
        labelKey: 'tileset.tool.fill',
        path: 'M19 11l-8-8-8 8 8 8 8-8z M5 19a2 2 0 0 0 2 2'
      }
    ]
  }
]

// Remembered variant per multi-variant slot (Aseprite: the button keeps your last
// choice). Keyed by slot id; defaults to the first variant.
const chosenVariant = ref<Record<string, ToolId>>({ rect: 'rect' })

/** The variant a slot's main button currently represents. */
function activeVariant(def: ToolDef): ToolVariant {
  if (def.variants.length === 1) return def.variants[0]
  const chosen = chosenVariant.value[def.id] ?? def.variants[0].key
  return def.variants.find((v) => v.key === chosen) ?? def.variants[0]
}

/** Is this slot the active tool (any of its variants)? */
function isActive(def: ToolDef): boolean {
  return def.variants.some((v) => v.key === props.tool)
}

/** Which slot's flyout is open, if any, and its variants + screen position. The
 *  flyout is teleported to <body> so the floating panel's `overflow:hidden` can't
 *  clip it; we anchor it with fixed coords measured from the caret button. */
const openFlyout = ref<string | null>(null)
const flyoutVariants = ref<ToolVariant[]>([])
const flyoutPos = ref<{ top: number; right: number }>({ top: 0, right: 0 })

function clickTool(def: ToolDef): void {
  openFlyout.value = null
  emit('update:tool', activeVariant(def).key)
}

function toggleFlyout(def: ToolDef, ev: MouseEvent): void {
  if (openFlyout.value === def.id) {
    openFlyout.value = null
    return
  }
  // Anchor the flyout to the LEFT of the caret's button (opens toward the canvas).
  const btn = (ev.currentTarget as HTMLElement).closest('.pt-slot') as HTMLElement
  const r = btn.getBoundingClientRect()
  flyoutPos.value = { top: r.top, right: window.innerWidth - r.left + 6 }
  flyoutVariants.value = def.variants
  openFlyout.value = def.id
}

function pickVariant(variant: ToolVariant): void {
  if (openFlyout.value) chosenVariant.value[openFlyout.value] = variant.key
  openFlyout.value = null
  emit('update:tool', variant.key)
}

const hasFlyoutOpen = computed(() => openFlyout.value !== null)
</script>

<template>
  <div class="pixel-toolbar">
    <div class="pt-tool-grid">
      <div
        v-for="def in toolDefs"
        :key="def.id"
        class="pt-slot"
        :class="{ 'has-variants': def.variants.length > 1 }"
      >
        <button
          class="pt-tool"
          :class="{ 'is-active': isActive(def) }"
          :title="t(activeVariant(def).labelKey)"
          @click="clickTool(def)"
        >
          <svg class="ico" viewBox="0 0 24 24">
            <path :d="activeVariant(def).path" :class="{ 'is-filled': activeVariant(def).filled }" />
          </svg>
        </button>

        <!-- Variant caret (only when the tool has >1 variant). The flyout itself
             is teleported to <body> so the panel's overflow can't clip it. -->
        <button
          v-if="def.variants.length > 1"
          class="pt-caret"
          :title="t('tileset.toolMode')"
          :aria-expanded="openFlyout === def.id"
          @click.stop="toggleFlyout(def, $event)"
        >
          <svg viewBox="0 0 8 8"><path d="M0 0h8L4 5z" /></svg>
        </button>
      </div>
    </div>

    <!-- Variant flyout — teleported out of the panel so overflow:hidden / auto on
         the floating panel cannot clip it (the real cause of the cut-off). -->
    <Teleport to="body">
      <template v-if="hasFlyoutOpen">
        <div class="pt-scrim" @click="openFlyout = null" />
        <div
          class="pt-flyout"
          role="menu"
          :style="{ top: `${flyoutPos.top}px`, right: `${flyoutPos.right}px` }"
        >
          <button
            v-for="variant in flyoutVariants"
            :key="variant.key"
            class="pt-flyout-item"
            :class="{ 'is-active': tool === variant.key }"
            :title="t(variant.labelKey)"
            role="menuitem"
            @click="pickVariant(variant)"
          >
            <svg class="ico" viewBox="0 0 24 24">
              <path :d="variant.path" :class="{ 'is-filled': variant.filled }" />
            </svg>
          </button>
        </div>
      </template>
    </Teleport>

    <div class="pt-history">
      <button
        class="pt-tool"
        :disabled="!canUndo"
        :title="t('tileset.undo')"
        @click="emit('undo')"
      >
        <svg class="ico" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
      </button>
      <button
        class="pt-tool"
        :disabled="!canRedo"
        :title="t('tileset.redo')"
        @click="emit('redo')"
      >
        <svg class="ico" viewBox="0 0 24 24"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h1" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pixel-toolbar {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--bc-space-3);
}
/* Scrim + flyout are teleported to <body>; they must sit above the floating
   panels (which raise their own z-index as they're touched). */
.pt-scrim {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.pt-tool-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--bc-space-2);
}
.pt-slot {
  position: relative;
}
.pt-history {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--bc-space-2);
  padding-top: var(--bc-space-2);
  border-top: 1px solid var(--bc-border-subtle);
}
.pt-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 44px;
  color: var(--bc-text-300);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
  transition: all 120ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.pt-tool:hover:not(:disabled) {
  color: var(--bc-text-100);
  border-color: var(--bc-border-strong);
}
.pt-tool:disabled {
  opacity: 0.35;
  cursor: default;
}
.pt-tool.is-active {
  color: var(--bc-arc-200);
  border-color: var(--bc-arc-400);
  background: rgba(94, 196, 255, 0.08);
  box-shadow: var(--bc-glow-arc);
}
.pt-tool .ico {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.85;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* Filled-shape variant (e.g. filled rectangle): solid interior so it reads as
   "filled" vs the outline variant, while keeping the crisp stroked border. */
.ico .is-filled {
  fill: currentColor;
  fill-opacity: 0.45;
}

/* Aseprite-style corner caret marking a tool with variants. */
.pt-caret {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  padding: 0;
  color: var(--bc-text-400);
  background: transparent;
  border: none;
  cursor: pointer;
}
.pt-caret:hover {
  color: var(--bc-arc-200);
}
.pt-caret svg {
  width: 7px;
  height: 7px;
  fill: currentColor;
}

/* Flyout listing the variants as icon buttons. Teleported to <body> and anchored
   with fixed top/right (measured from the caret) so it opens to the LEFT of the
   button and is never clipped by the panel's overflow. */
.pt-flyout {
  position: fixed;
  z-index: 1001;
  display: flex;
  flex-direction: row;
  gap: 4px;
  padding: 4px;
  background: var(--bc-grad-plate);
  border: 1px solid var(--bc-border-strong);
  border-radius: var(--bc-radius-md);
  box-shadow: var(--bc-shadow-3), var(--bc-bevel);
}
.pt-flyout-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: var(--bc-text-300);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius-md);
  cursor: pointer;
  transition: all 100ms ease;
}
.pt-flyout-item:hover {
  color: var(--bc-text-100);
  border-color: var(--bc-border-strong);
}
.pt-flyout-item.is-active {
  color: var(--bc-arc-200);
  border-color: var(--bc-arc-400);
  background: rgba(94, 196, 255, 0.08);
  box-shadow: var(--bc-glow-arc);
}
.pt-flyout-item .ico {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.85;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@renderer/stores/ui'
import { useProjectStore } from '@renderer/stores/project'
import PanelResizer from '@renderer/components/PanelResizer.vue'
import { scanOutline, type OutlineSymbol } from '@renderer/language/outline'
import { revealLine } from '@renderer/monaco/editorBridge'

const { t } = useI18n()
const ui = useUiStore()
const project = useProjectStore()

const symbols = computed<OutlineSymbol[]>(() => scanOutline(project.activeContent))
</script>

<template>
  <section
    class="panel"
    id="panel-outliner"
    data-side="right"
    :style="{ flex: `0 0 ${ui.sizes.outliner}px`, width: `${ui.sizes.outliner}px` }"
  >
    <PanelResizer panel="outliner" dir="w" />
    <div class="panel-head">
      <button class="collapse-btn" :title="t('outliner.collapse')" @click="ui.collapse('outliner')">
        <svg class="ico-sm" viewBox="0 0 24 24"><path d="m9 18 6-6 6 6" transform="rotate(90 12 12)" /></svg>
      </button>
      <span class="bc-label">{{ t('outliner.title') }}</span>
    </div>
    <div class="panel-body outliner">
      <button
        v-for="s in symbols"
        :key="`${s.kind}:${s.name}:${s.line}`"
        class="ol-row"
        :class="s.kind === 'section' ? 'ol-section' : 'ol-fn'"
        style="--d: 0"
        :title="t('outliner.lineTitle', { n: s.line })"
        @click="revealLine(s.line)"
      >
        <svg v-if="s.kind === 'section'" class="ico-sm" viewBox="0 0 24 24"><path d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 9h6M9 13h6M9 17h4" /></svg>
        <svg v-else class="ico-sm" viewBox="0 0 24 24"><path d="M4 7V5a2 2 0 0 1 2-2h2M4 17v2a2 2 0 0 0 2 2h2M20 7V5a2 2 0 0 0-2-2h-2M20 17v2a2 2 0 0 1-2 2h-2" /></svg>
        <span class="ol-name">{{ s.name }}</span>
        <span v-if="s.kind !== 'section'" class="ol-kind">{{
          s.kind === 'statement' ? t('outliner.kind.statement') : t('outliner.kind.function')
        }}</span>
      </button>
      <div v-if="!symbols.length" class="outline-empty bc-body-sm">
        {{ t('outliner.empty') }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.ol-row {
  width: 100%;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}
.ol-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ol-kind {
  font: 400 10px/1 var(--bc-font-mono);
  color: var(--bc-text-500);
}
/* A user '; #' waypoint: a section header, not a symbol. Set apart so the eye
   reads it as a divider the functions below it belong to. */
.ol-section {
  margin-top: var(--bc-space-2);
  color: var(--bc-text-300);
}
.ol-section:first-child {
  margin-top: 0;
}
.ol-section .ol-name {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
}
.ol-section .ico-sm {
  color: var(--bc-text-500);
}
.outline-empty {
  padding: var(--bc-space-4);
  color: var(--bc-text-400);
}
</style>

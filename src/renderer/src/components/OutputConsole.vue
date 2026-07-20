<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useUiStore } from '@renderer/stores/ui'
import { useOutputStore } from '@renderer/stores/output'
import { useProjectStore } from '@renderer/stores/project'
import { revealPosition } from '@renderer/monaco/editorBridge'
import PanelResizer from '@renderer/components/PanelResizer.vue'
import type { BuildLogLine } from '@shared/ipc'

const { t } = useI18n()
const ui = useUiStore()
const output = useOutputStore()
const project = useProjectStore()
const router = useRouter()
const bodyEl = ref<HTMLElement | null>(null)

// Jump from a located console line (a compile error/warning) to its spot in the code
// editor — opening the RIGHT file first, even across an Include boundary (B3.T4).
async function jumpTo(loc: NonNullable<BuildLogLine['loc']>): Promise<void> {
  const rel = loc.file ?? project.entry
  if (!rel || !rel.toLowerCase().endsWith('.crumb')) return
  try {
    if (project.activeRel !== rel) await project.openCrumb(rel)
    if (router.currentRoute.value.name !== 'code') await router.push({ name: 'code' })
    await nextTick() // let the editor swap to the file's content before we scroll
    revealPosition(loc.line, loc.col)
  } catch {
    // the file may have been deleted/renamed since the build — ignore the jump
  }
}

// Auto-scroll to the newest line as output arrives.
watch(
  () => output.lines.length,
  async () => {
    await nextTick()
    if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight
  }
)
</script>

<template>
  <section
    class="panel console"
    id="panel-console"
    :style="{ height: `${ui.sizes.console}px` }"
  >
    <PanelResizer panel="console" dir="n" />
    <div class="panel-head">
      <span class="bc-label">{{ t('console.title') }}</span>
      <div class="con-head-right">
        <button
          v-if="output.lines.length"
          class="collapse-btn"
          :title="t('console.clear')"
          @click="output.clear()"
        >
          <svg class="ico-sm" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
        </button>
        <button class="collapse-btn" :title="t('console.collapse')" @click="ui.collapse('console')">
          <svg class="ico-sm" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
    </div>
    <div ref="bodyEl" class="panel-body con-body">
      <div v-if="!output.lines.length" class="con-empty">{{ t('console.empty') }}</div>
      <template v-for="(l, i) in output.lines" :key="i">
        <pre
          v-if="l.loc"
          class="con-line con-jump"
          :class="`lvl-${l.level}`"
          role="button"
          tabindex="0"
          :title="t('console.jumpHint')"
          @click="jumpTo(l.loc)"
          @keydown.enter="jumpTo(l.loc)"
        >{{ l.text }}</pre>
        <pre v-else class="con-line" :class="`lvl-${l.level}`">{{ l.text }}</pre>
      </template>
    </div>
  </section>
</template>

<style scoped>
.con-empty {
  color: var(--bc-text-500);
  font-family: var(--bc-font-sans);
  font-size: 12.5px;
}
.con-line {
  margin: 0;
  padding: 1px 0;
  font-family: var(--bc-font-mono);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--bc-text-200);
}
.con-line.lvl-cmd {
  color: var(--bc-arc-200);
}
.con-line.lvl-ok {
  color: var(--bc-success);
}
.con-line.lvl-error {
  color: var(--bc-danger);
}
.con-line.lvl-warn {
  color: var(--bc-copper-300);
}
.con-line.con-jump {
  cursor: pointer;
}
.con-line.con-jump:hover {
  text-decoration: underline;
}
.con-line.con-jump:focus-visible {
  outline: 1px solid var(--bc-arc-300);
  outline-offset: -1px;
}
.con-head-right {
  display: flex;
  gap: 4px;
}
</style>

<script setup lang="ts">
// Health-bar strip — full width, centered, NOT collapsible (cost-honesty
// always visible; see _plans/BREADCRAFT_IDE.md §5).
//
// RAM bar (STAHL S1c): shows the last build's program size against the PLANNED
// ceiling (the reserved VIC island $3000, or $D000 with no graphics). It fills as
// the program grows and turns amber/red near the wall the linker would otherwise
// hit — so the user sees "getting full" instead of only meeting a hard error.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RamPool } from '@shared/ipc'
import { useOutputStore } from '@renderer/stores/output'
import { useProjectStore } from '@renderer/stores/project'

const { t } = useI18n()
const output = useOutputStore()
const project = useProjectStore()

// RAM is one or two POOLS (B1.T5). The low pool (code + data) is the RamInfo itself; a
// bank-1 / sprites-only layout adds a `high` pool (big arrays above the graphics bank)
// that walls independently, so it gets its own bar. With one pool the bar is just "RAM".
const ram = computed(() => output.ram)
const high = computed(() => ram.value?.high ?? null)

// Whether to show the SECOND RAM bar — driven by the PROJECT, not only the last build, so
// the strip shows its real structure from the start (not just after a build, which was
// confusing). After a build the map is authoritative (`ram.high` present ⇔ two pools);
// before one we predict from the manifest. RAM splits into two pools whenever graphics
// take their own region: a custom charset (→ bank 1) OR sprites (→ a reserved island with
// BSS above it) — so predict from EITHER. A truly graphics-less project honestly stays one
// pool/one bar. If the prediction and the build ever disagree, the build wins (replaces `ram`).
const expectsHighPool = computed(() =>
  ram.value ? !!ram.value.high : project.assets.charsets.length > 0 || project.assets.sprites.length > 0
)
const lowLabel = computed(() => (expectsHighPool.value ? t('health.ram.code') : 'RAM'))

const pctOf = (p: RamPool): number => Math.min(100, Math.round(p.fraction * 100))
const hex = (addr: number): string => '$' + addr.toString(16).toUpperCase()
const fillClassOf = (p: RamPool): string =>
  p.state === 'over' ? 'hb-fill-over' : p.state === 'warn' ? 'hb-fill-warn' : 'hb-fill-arc'

// PERF bar: an ESTIMATE of the frame-loop cost extrapolated from the code (a guess,
// never a runtime measurement — the `~` says so). It climbs as the .crumb does more
// expensive work, so the cost is visible while you write.
const perf = computed(() => output.perf)
// STAHL S6: "over" is the one state a newbie must READ, not just see as red — the
// logic no longer fits one frame, so VWait silently halves the game to 25 fps.
const perfOver = computed(() => perf.value?.state === 'over')
// The value text shows the HONEST percent (uncapped — an over-budget frame reads e.g.
// "~135 %"), while the bar fill can't be more than full, so its width caps at 100%.
const perfPct = computed(() => (perf.value ? Math.round(perf.value.fraction * 100) : 0))
const perfWidth = computed(() => Math.min(100, perfPct.value))
const perfFillClass = computed(() => {
  if (!perf.value) return 'hb-fill-filament'
  if (perf.value.state === 'over') return 'hb-fill-over'
  if (perf.value.state === 'warn') return 'hb-fill-warn'
  return 'hb-fill-filament'
})
</script>

<template>
  <div class="health">
    <div class="health-inner">
      <div class="hb">
        <div class="hb-top">
          <span class="bc-label">{{ lowLabel }}</span>
          <span class="hb-val" :class="{ 'hb-nodata': !ram }">{{ ram ? pctOf(ram) + ' %' : '—' }}</span>
        </div>
        <div class="hb-track">
          <div class="hb-fill" :class="fillClassOf(ram)" :style="{ width: pctOf(ram) + '%' }" v-if="ram" />
        </div>
        <div class="hb-meta">
          <template v-if="ram">
            {{ t('health.ram.line', { used: ram.usedBytes, budget: ram.budgetBytes, free: ram.freeBytes, ceiling: hex(ram.ceilingAddr) }) }}
          </template>
          <template v-else>{{ t('health.ram.meta') }}</template>
        </div>
      </div>

      <!-- Second RAM pool (B1.T5): the big arrays high in RAM, present in the bank-1 /
           sprites-only layout. It can't trade bytes with code/data, so it walls on its own
           and gets its own bar. Shown whenever the project expects two pools (predicted
           before the first build, exact after) — empty "—" until a build fills it. -->
      <div class="hb" v-if="expectsHighPool">
        <div class="hb-top">
          <span class="bc-label">{{ t('health.ram.arrays') }}</span>
          <span class="hb-val" :class="{ 'hb-nodata': !high }">{{ high ? pctOf(high) + ' %' : '—' }}</span>
        </div>
        <div class="hb-track">
          <div class="hb-fill" :class="fillClassOf(high)" :style="{ width: pctOf(high) + '%' }" v-if="high" />
        </div>
        <div class="hb-meta">
          <template v-if="high">
            {{ t('health.ram.line', { used: high.usedBytes, budget: high.budgetBytes, free: high.freeBytes, ceiling: hex(high.ceilingAddr) }) }}
          </template>
          <template v-else>{{ t('health.ram.meta') }}</template>
        </div>
      </div>

      <div class="hb">
        <div class="hb-top">
          <span class="bc-label">PERF · FRAME</span>
          <span class="hb-val" :class="{ 'hb-nodata': !perf, 'hb-val-over': perfOver }">{{ perf ? '~' + perfPct + ' %' : '—' }}</span>
        </div>
        <div class="hb-track">
          <div class="hb-fill" :class="perfFillClass" :style="{ width: perfWidth + '%' }" />
        </div>
        <div class="hb-meta" :class="{ 'hb-meta-over': perfOver }">
          <template v-if="perfOver">
            <strong>{{ t('health.perf.full') }}</strong> — {{ t('health.perf.fullHint') }}
          </template>
          <template v-else-if="perf">{{ t('health.perf.estimate', { cycles: perf.cyclesPerFrame, budget: perf.budgetCycles, region: perf.region }) }}</template>
          <template v-else>{{ t('health.perf.meta') }}</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hb-nodata {
  color: var(--bc-text-500);
}
/* STAHL S1c: amber near the ceiling, red at/over it — cost-honest at a glance. */
.hb-fill-warn {
  background: var(--bc-warn, #e0a000);
}
.hb-fill-over {
  background: var(--bc-danger, #d04040);
}
/* STAHL S6: the "FRAME VOLL" state reads as an alarm, not just a red bar. */
.hb-val-over,
.hb-meta-over {
  color: var(--bc-danger, #d04040);
}
.hb-meta-over strong {
  font-weight: 700;
  letter-spacing: 0.04em;
}
</style>

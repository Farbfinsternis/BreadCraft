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
import { useOutputStore } from '@renderer/stores/output'

const { t } = useI18n()
const output = useOutputStore()

const ram = computed(() => output.ram)
const pct = computed(() => (ram.value ? Math.min(100, Math.round(ram.value.fraction * 100)) : 0))
const ceilingHex = computed(() => (ram.value ? '$' + ram.value.ceilingAddr.toString(16).toUpperCase() : ''))
const fillClass = computed(() => {
  if (!ram.value) return 'hb-fill-arc'
  if (ram.value.state === 'over') return 'hb-fill-over'
  if (ram.value.state === 'warn') return 'hb-fill-warn'
  return 'hb-fill-arc'
})

// PERF bar: an ESTIMATE of the frame-loop cost extrapolated from the code (a guess,
// never a runtime measurement — the `~` says so). It climbs as the .crumb does more
// expensive work, so the cost is visible while you write.
const perf = computed(() => output.perf)
const perfPct = computed(() => (perf.value ? Math.min(100, Math.round(perf.value.fraction * 100)) : 0))
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
          <span class="bc-label">RAM</span>
          <span class="hb-val" :class="{ 'hb-nodata': !ram }">{{ ram ? pct + ' %' : '—' }}</span>
        </div>
        <div class="hb-track">
          <div class="hb-fill" :class="fillClass" :style="{ width: pct + '%' }" />
        </div>
        <div class="hb-meta">
          <template v-if="ram">
            {{ ram.usedBytes }} / {{ ram.budgetBytes }} B · {{ ram.freeBytes }} B frei bis {{ ceilingHex }}
          </template>
          <template v-else>{{ t('health.ram.meta') }}</template>
        </div>
      </div>

      <div class="hb">
        <div class="hb-top">
          <span class="bc-label">PERF · FRAME</span>
          <span class="hb-val" :class="{ 'hb-nodata': !perf }">{{ perf ? '~' + perfPct + ' %' : '—' }}</span>
        </div>
        <div class="hb-track">
          <div class="hb-fill" :class="perfFillClass" :style="{ width: perfPct + '%' }" />
        </div>
        <div class="hb-meta">
          <template v-if="perf">~{{ perf.cyclesPerFrame }} Takte/Frame von {{ perf.budgetCycles }} · geschätzt</template>
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
</style>

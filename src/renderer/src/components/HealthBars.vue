<script setup lang="ts">
// Health-bar strip — full width, centered, NOT collapsible (cost-honesty
// always visible; see _plans/BREADCRAFT_IDE.md §5).
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="health">
    <div class="health-inner">
      <div class="hb">
        <div class="hb-top">
          <span class="bc-label">RAM</span>
          <span class="hb-val hb-nodata">—</span>
        </div>
        <div class="hb-track"><div class="hb-fill hb-fill-arc" style="width: 0%" /></div>
        <div class="hb-meta">{{ t('health.ram.meta') }}</div>
      </div>

      <div class="hb">
        <div class="hb-top">
          <span class="bc-label">PERF · RASTER</span>
          <span class="hb-val hb-nodata">—</span>
        </div>
        <div class="hb-track"><div class="hb-fill hb-fill-filament" style="width: 0%" /></div>
        <div class="hb-meta">{{ t('health.perf.meta') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hb-nodata {
  color: var(--bc-text-500);
}
</style>

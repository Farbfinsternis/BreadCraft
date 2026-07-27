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
import { SCREEN_W } from '@shared/asset-formats'
import { levelScreens, bytesPerScreen } from '@renderer/views/level-budget'
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

// The scrolling level's share of the low pool (S1.B4). A wide world is usually the
// biggest single thing in a C64 game's RAM, so the bar NAMES it: "of that, level: 8 KB,
// 5 screens" answers "what do I shorten?" where a bare percentage only says "it's full".
const level = computed(() => output.level)
const levelKb = computed(() => (level.value ? (level.value.bytes / 1024).toFixed(1) : '0'))
// Screens = the unit a level designer thinks in — the same reckoning the map editor's
// counter uses while painting (views/level-budget), so both tell one story.
const levelScreenCount = computed(() =>
  level.value ? levelScreens(level.value.columns, SCREEN_W) : 0
)
// …and how many MORE would fit. While painting, the map editor reckons against a reserved
// 16 KB (it cannot know the program); after a build the free bytes are MEASURED, so this
// is the same question answered exactly — "how much level do I still have room for?"
const screensLeft = computed(() => {
  if (!level.value || !ram.value) return 0
  const perScreen = bytesPerScreen(SCREEN_W, level.value.bandRows, level.value.model)
  return Math.max(0, Math.floor(ram.value.freeBytes / perScreen))
})

// PERF bar: an ESTIMATE of the frame-loop cost extrapolated from the code (a guess,
// never a runtime measurement — the `~` says so). It climbs as the .crumb does more
// expensive work, so the cost is visible while you write.
const perf = computed(() => output.perf)
// A scrolling frame has TWO deadlines (S1.B4/Schritt 2): the band must be moved below the
// band, and what that leaves of the frame is the program's own room. The bar shows the
// nearer wall of the HEAVY frame — every 8th pixel the band physically moves a column, and
// an average over the eight would hide the only frame that can fail (SCROLLING_PLAN T4).
const world = computed(() => perf.value?.world ?? null)
// A world whose window travels has that heavy frame; a standing one does not — but it runs
// on the same split, so its room is worth naming all the same.
const scrolls = computed(() => (world.value?.everyFrames ?? 0) > 0)
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
            <!-- Name the world's bytes (S1.B4): the level is usually the biggest single
                 item in the pool, and "shorten the level" is a lever the user has. -->
            <span class="hb-level" v-if="level">
              · {{ t('health.ram.level', { kb: levelKb, screens: levelScreenCount, model: t('health.ram.model.' + level.model) }) }}
              · {{ t('health.ram.levelRoom', { screens: screensLeft }) }}
            </span>
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
          <!-- With a travelling window the bar speaks about the HEAVY frame, and says so —
               a bar that quietly averaged the eight frames would read as far safer than
               the machine is. -->
          <span class="bc-label">{{ scrolls ? t('health.perf.labelPeak') : t('health.perf.label') }}</span>
          <span class="hb-val" :class="{ 'hb-nodata': !perf, 'hb-val-over': perfOver }">{{ perf ? '~' + perfPct + ' %' : '—' }}</span>
        </div>
        <div class="hb-track">
          <div class="hb-fill" :class="perfFillClass" :style="{ width: perfWidth + '%' }" />
        </div>
        <div class="hb-meta" :class="{ 'hb-meta-over': perfOver }">
          <template v-if="perfOver">
            <strong>{{ t('health.perf.full') }}</strong> —
            <!-- WHICH wall is the near one decides the lever, so the hint names it: the
                 band's height (ours, not the C64's — this engine pays per band row) or the
                 program's own work between two VWaits. Since Schritt 2 a flatter play field
                 helps BOTH, so both hints may point at it. -->
            <template v-if="world && world.wall === 'tail'">{{ t('health.perf.fullScroll', { rows: world.bandRows, tail: world.tailCycles }) }}</template>
            <template v-else-if="world">{{ t('health.perf.fullRoom', { room: world.roomCycles, rows: world.bandRows }) }}</template>
            <template v-else>{{ t('health.perf.fullHint') }}</template>
          </template>
          <template v-else-if="world && scrolls">
            {{ t('health.perf.peak', { every: world.everyFrames, tailUsed: world.tailUsed, tail: world.tailCycles, roomUsed: world.roomUsed, room: world.roomCycles }) }}
          </template>
          <template v-else-if="world">
            {{ t('health.perf.world', { rows: world.bandRows, room: world.roomCycles, roomUsed: world.roomUsed }) }}
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
/* The level's share sits in the same meta line but reads as an aside, not as a second
   figure competing with the pool's own numbers (S1.B4). */
.hb-level {
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

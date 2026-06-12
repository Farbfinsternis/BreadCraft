import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { BuildLogLine, RamInfo } from '@shared/ipc'

/**
 * The Output console's line buffer. Deliberately NOT persisted (build/run logs
 * are transient — a conscious exception to the persist-everything rule). Also
 * tracks a `busy` flag so the toolbar can show a build is in progress, and the
 * latest build's RAM usage so the health-bar can show it (STAHL S1c).
 */
export const useOutputStore = defineStore('output', () => {
  const lines = ref<BuildLogLine[]>([])
  const busy = ref(false)
  /** RAM usage from the most recent build, or null before the first build. */
  const ram = ref<RamInfo | null>(null)

  function clear(): void {
    lines.value = []
  }

  function append(line: BuildLogLine): void {
    lines.value.push(line)
  }

  function appendMany(more: BuildLogLine[]): void {
    lines.value.push(...more)
  }

  return { lines, busy, ram, clear, append, appendMany }
})

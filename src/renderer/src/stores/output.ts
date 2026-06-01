import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { BuildLogLine } from '@shared/ipc'

/**
 * The Output console's line buffer. Deliberately NOT persisted (build/run logs
 * are transient — a conscious exception to the persist-everything rule). Also
 * tracks a `busy` flag so the toolbar can show a build is in progress.
 */
export const useOutputStore = defineStore('output', () => {
  const lines = ref<BuildLogLine[]>([])
  const busy = ref(false)

  function clear(): void {
    lines.value = []
  }

  function append(line: BuildLogLine): void {
    lines.value.push(line)
  }

  function appendMany(more: BuildLogLine[]): void {
    lines.value.push(...more)
  }

  return { lines, busy, clear, append, appendMany }
})

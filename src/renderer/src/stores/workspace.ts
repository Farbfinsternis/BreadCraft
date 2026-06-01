import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * Workspace state mirrored from the main process. The actual paths + first-run
 * flag live in main (userData JSON, see src/main/config.ts); this store is the
 * renderer's view and the driver for the first-run onboarding flow.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaceRoot = ref<string | null>(null)
  const needsSetup = ref(false)
  const ready = ref(false)

  async function refresh(): Promise<void> {
    const { needsSetup: needs, config } = await window.breadcraft.workspace.status()
    needsSetup.value = needs
    workspaceRoot.value = config.workspaceRoot
    ready.value = true
  }

  async function suggestRoot(): Promise<string> {
    return window.breadcraft.workspace.defaultRoot()
  }

  async function chooseRoot(current: string): Promise<string | null> {
    return window.breadcraft.workspace.choose(current)
  }

  async function initWith(root: string): Promise<void> {
    const config = await window.breadcraft.workspace.init(root)
    workspaceRoot.value = config.workspaceRoot
    needsSetup.value = !config.initialized
  }

  return { workspaceRoot, needsSetup, ready, refresh, suggestRoot, chooseRoot, initWith }
})

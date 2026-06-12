<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import IdeToolbar from '@renderer/components/IdeToolbar.vue'
import ProjectExplorer from '@renderer/components/ProjectExplorer.vue'
import OutlinePanel from '@renderer/components/OutlinePanel.vue'
import HealthBars from '@renderer/components/HealthBars.vue'
import OutputConsole from '@renderer/components/OutputConsole.vue'
import StatusBar from '@renderer/components/StatusBar.vue'
import WorkspaceSetup from '@renderer/components/WorkspaceSetup.vue'
import SettingsModal from '@renderer/components/SettingsModal.vue'
import PromptModal from '@renderer/components/PromptModal.vue'
import NewProjectModal from '@renderer/components/NewProjectModal.vue'
import SaveAsModal from '@renderer/components/SaveAsModal.vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { EDITOR_ROUTE_NAMES } from '@renderer/router'
import { useUiStore } from '@renderer/stores/ui'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useProjectStore } from '@renderer/stores/project'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const workspace = useWorkspaceStore()
const project = useProjectStore()

// Zen mode only takes effect in the graphics editors (it's only offered there;
// the code view always keeps its panels). Persisted zen stays remembered but is
// inert outside the editors, so the user can never get stuck panel-less.
const zenActive = computed(
  () => ui.zen && (EDITOR_ROUTE_NAMES as readonly string[]).includes(String(route.name))
)

// Honor the startupMode setting: 'last' returns a project to restore, 'welcome'
// (default) returns null → show the welcome page.
async function runStartup(): Promise<void> {
  const opened = await window.breadcraft.project.startup()
  if (opened) {
    project.load(opened)
    router.push({ name: 'code' })
  } else {
    router.push({ name: 'welcome' })
  }
}

onMounted(async () => {
  await workspace.refresh()
  if (!workspace.needsSetup) await runStartup()
})

// After first-run setup completes, the dialog flips needsSetup → false.
watch(
  () => workspace.needsSetup,
  async (needs, was) => {
    if (was && !needs && !project.dir) await runStartup()
  }
)
</script>

<template>
  <!-- First-run gate: until a workspace exists, show only the setup dialog. -->
  <WorkspaceSetup v-if="workspace.ready && workspace.needsSetup" />

  <div v-else-if="workspace.ready" class="ide">
    <IdeToolbar />

    <div class="row-main">
      <ProjectExplorer v-show="!zenActive && !ui.collapsed.explorer" />
      <button
        v-show="!zenActive && ui.collapsed.explorer"
        class="rail-stub"
        @click="ui.expand('explorer')"
      >
        <svg class="ico-sm" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
        <span class="rail-stub-label">{{ t('explorer.title') }}</span>
      </button>

      <section class="panel panel-grow" id="panel-editor">
        <router-view />
      </section>

      <OutlinePanel v-show="!zenActive && !ui.collapsed.outliner" />
      <button
        v-show="!zenActive && ui.collapsed.outliner"
        class="rail-stub"
        @click="ui.expand('outliner')"
      >
        <svg class="ico-sm" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        <span class="rail-stub-label">{{ t('outliner.title') }}</span>
      </button>
    </div>

    <HealthBars />

    <OutputConsole v-show="!zenActive && !ui.collapsed.console" />
    <button
      v-show="!zenActive && ui.collapsed.console"
      class="rail-stub stub-console"
      @click="ui.expand('console')"
    >
      <svg class="ico-sm" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6" /></svg>
      <span class="rail-stub-label">{{ t('console.railLabel') }}</span>
    </button>

    <StatusBar />

    <!-- Global settings modal: lives above the IDE, toggled from the toolbar. -->
    <SettingsModal />
  </div>

  <!-- Global prompt dialog: name entry / messages, replacing Electron's dead
       window.prompt/alert. Outside both branches so it's always available. -->
  <PromptModal />

  <!-- New-Project dialog: name + graphics mode + boilerplate (M1.T6). -->
  <NewProjectModal />

  <!-- Save-As file dialog: pick folder + name in the project (P2.T0b). -->
  <SaveAsModal />
</template>

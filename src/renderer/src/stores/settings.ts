import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Locale, StartupMode, VicePathCheck } from '@shared/ipc'
import { setLocale } from '@renderer/i18n'

/**
 * Global (per-machine) settings, mirrored from the main process (userData JSON).
 * The modal edits a *draft*: nothing is persisted until apply(); cancel() simply
 * drops the draft. This keeps the apply / cancel behaviour predictable.
 */
export const useSettingsStore = defineStore('settings', () => {
  // Persisted snapshot (last applied) and the live editable draft.
  const startupMode = ref<StartupMode>('welcome')
  const vicePath = ref<string | null>(null)
  const language = ref<Locale>('en')

  const draftStartupMode = ref<StartupMode>('welcome')
  const draftVicePath = ref<string | null>(null)
  const draftLanguage = ref<Locale>('en')

  const open = ref(false)
  const viceCheck = ref<VicePathCheck | null>(null)

  /** Pull the persisted config into the live snapshot. */
  async function refresh(): Promise<void> {
    const cfg = await window.breadcraft.settings.read()
    startupMode.value = cfg.startupMode
    vicePath.value = cfg.vicePath
    // language is resolved (never null) by settings:language on boot, but the raw
    // config may still read null very early — fall back to the active i18n locale.
    if (cfg.language) language.value = cfg.language
  }

  /** Open the modal: seed the draft from the current snapshot. */
  async function openModal(): Promise<void> {
    await refresh()
    draftStartupMode.value = startupMode.value
    draftVicePath.value = vicePath.value
    draftLanguage.value = language.value
    await revalidateVice()
    open.value = true
  }

  /** Close without persisting; the draft is discarded. */
  function cancel(): void {
    open.value = false
  }

  /** Persist the draft, then close. */
  async function apply(): Promise<void> {
    const cfg = await window.breadcraft.settings.write({
      startupMode: draftStartupMode.value,
      vicePath: draftVicePath.value,
      language: draftLanguage.value
    })
    startupMode.value = cfg.startupMode
    vicePath.value = cfg.vicePath
    if (cfg.language) {
      language.value = cfg.language
      setLocale(cfg.language) // switch the live UI language immediately
    }
    open.value = false
  }

  /** Open a native file picker for the VICE executable; updates the draft. */
  async function browseVice(): Promise<void> {
    const picked = await window.breadcraft.settings.browseVice(draftVicePath.value)
    if (picked) {
      draftVicePath.value = picked
      await revalidateVice()
    }
  }

  /** Re-check the drafted VICE path so the UI can show a status hint. */
  async function revalidateVice(): Promise<void> {
    if (!draftVicePath.value) {
      viceCheck.value = null
      return
    }
    viceCheck.value = await window.breadcraft.settings.checkVice(draftVicePath.value)
  }

  return {
    startupMode,
    vicePath,
    language,
    draftStartupMode,
    draftVicePath,
    draftLanguage,
    open,
    viceCheck,
    refresh,
    openModal,
    cancel,
    apply,
    browseVice,
    revalidateVice
  }
})

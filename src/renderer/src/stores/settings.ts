import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Locale, StartupMode, VicePathCheck } from '@shared/ipc'
import { setLocale } from '@renderer/i18n'

/** The Settings categories — also the target a caller can jump straight to (T5). */
export type SettingsSection = 'general' | 'emulator' | 'language' | 'about'

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
  // Which category the pane shows — lifted into the store so callers can open the
  // modal focused on a section (T5: the "set up VICE" prompt jumps to 'emulator').
  const section = ref<SettingsSection>('general')
  // A one-off note under the VICE field: a browsed folder held no VICE, or auto-detect
  // found nothing. Cleared whenever the path changes (revalidateVice).
  const viceNote = ref<'browse-notfound' | 'detect-notfound' | null>(null)
  // The running app's version, shown in the About / licenses section (T7). Fetched
  // lazily the first time the modal opens; the main process reads it from package.json.
  const appVersion = ref<string | null>(null)

  // ---- First-run onboarding (T2) ----
  // The onboarding overlay: whether it's open, the auto-detected path (drives the
  // "found — use it?" state vs. the three-way screen), and a note if a link failed.
  const onboardingOpen = ref(false)
  const onboardingDetected = ref<string | null>(null)
  const onboardingNote = ref<'link-notfound' | null>(null)
  // In-app download (T3): the phase drives the progress/error views; percent is null
  // when the server didn't report a size (indeterminate).
  const onboardingPhase = ref<'idle' | 'downloading' | 'verifying' | 'extracting' | 'error'>('idle')
  const onboardingPercent = ref<number | null>(null)
  const onboardingError = ref<string | null>(null)

  /** Pull the persisted config into the live snapshot. */
  async function refresh(): Promise<void> {
    const cfg = await window.breadcraft.settings.read()
    startupMode.value = cfg.startupMode
    vicePath.value = cfg.vicePath
    // language is resolved (never null) by settings:language on boot, but the raw
    // config may still read null very early — fall back to the active i18n locale.
    if (cfg.language) language.value = cfg.language
  }

  /** Open the modal: seed the draft from the current snapshot. Pass `focus` to land
   *  directly on a category (T5 opens straight on 'emulator' to set up VICE). */
  async function openModal(focus: SettingsSection = 'general'): Promise<void> {
    await refresh()
    draftStartupMode.value = startupMode.value
    draftVicePath.value = vicePath.value
    draftLanguage.value = language.value
    section.value = focus
    viceNote.value = null
    if (appVersion.value === null) appVersion.value = await window.breadcraft.app.version()
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

  /** Open a native FOLDER picker; BreadCraft finds the VICE executable inside it and
   *  fills the draft (T4/T5). A folder with no VICE sets a `browse-notfound` note. */
  async function browseVice(): Promise<void> {
    const res = await window.breadcraft.settings.browseVice(draftVicePath.value)
    if (res.status === 'ok' && res.path) {
      draftVicePath.value = res.path
      await revalidateVice() // clears the note and shows the green "found" hint
    } else if (res.status === 'notfound') {
      viceNote.value = 'browse-notfound'
    }
    // cancelled → leave the draft untouched
  }

  /** Ask the main process to find VICE automatically (T1). Fills the draft if found,
   *  otherwise leaves a `detect-notfound` note so the user knows to pick the folder. */
  async function autoDetectVice(): Promise<void> {
    const found = await window.breadcraft.settings.detectVice()
    if (found) {
      draftVicePath.value = found
      await revalidateVice() // clears the note and shows the green "found" hint
    } else {
      viceNote.value = 'detect-notfound'
    }
  }

  /** Persist just the VICE path (no draft/apply cycle) and update the live snapshot.
   *  Used by the onboarding, whose actions commit immediately. */
  async function persistVicePath(path: string): Promise<void> {
    const cfg = await window.breadcraft.settings.write({ vicePath: path })
    vicePath.value = cfg.vicePath
  }

  /** Open the first-run onboarding overlay: detect VICE up front so it can offer
   *  "found — use it?" (one click) or the three-way screen. Works on demand too (the
   *  Run prompt reopens it), independent of the auto-open gate. */
  async function openOnboarding(): Promise<void> {
    onboardingNote.value = null
    onboardingPhase.value = 'idle'
    onboardingPercent.value = null
    onboardingError.value = null
    onboardingDetected.value = await window.breadcraft.settings.detectVice()
    onboardingOpen.value = true
  }

  /** Auto-open the onboarding exactly once on a machine that has no VICE set up yet
   *  (T2 acceptance). Already configured, or already seen → skip and never nag. */
  async function maybeOpenOnboarding(): Promise<void> {
    const cfg = await window.breadcraft.settings.read()
    if (cfg.viceOnboardingSeen) return
    if (cfg.vicePath) {
      // Already configured on an earlier version → mark seen, don't show the screen.
      await window.breadcraft.settings.dismissViceOnboarding()
      return
    }
    await openOnboarding()
  }

  /** Close the overlay; `seen: true` remembers it so it won't auto-open again. */
  async function closeOnboarding(seen: boolean): Promise<void> {
    if (seen) await window.breadcraft.settings.dismissViceOnboarding()
    onboardingOpen.value = false
  }

  /** "Use it" on the found-VICE banner: adopt the detected path and close. */
  async function onboardingUseDetected(): Promise<void> {
    if (onboardingDetected.value) await persistVicePath(onboardingDetected.value)
    await closeOnboarding(true)
  }

  /** "I have it → choose folder": folder picker; adopt on success, note on empty. */
  async function onboardingLink(): Promise<void> {
    const res = await window.breadcraft.settings.browseVice(vicePath.value)
    if (res.status === 'ok' && res.path) {
      await persistVicePath(res.path)
      await closeOnboarding(true)
    } else if (res.status === 'notfound') {
      onboardingNote.value = 'link-notfound'
    }
    // cancelled → stay on the screen
  }

  /** "Download VICE" (T3): fetch the pinned build in-app with progress, verify + extract,
   *  then adopt it and close. On any failure, show the error view with fallbacks. */
  async function onboardingDownload(): Promise<void> {
    onboardingNote.value = null
    onboardingError.value = null
    onboardingPercent.value = null
    onboardingPhase.value = 'downloading'
    const stop = window.breadcraft.settings.onViceProgress((p) => {
      onboardingPhase.value = p.phase
      onboardingPercent.value = typeof p.percent === 'number' ? p.percent : null
    })
    try {
      const res = await window.breadcraft.settings.downloadVice()
      if (res.ok && res.path) {
        vicePath.value = res.path
        await closeOnboarding(true)
        onboardingPhase.value = 'idle'
      } else {
        onboardingError.value = res.error ?? 'unknown'
        onboardingPhase.value = 'error'
      }
    } catch (e) {
      onboardingError.value = String((e as Error).message ?? e)
      onboardingPhase.value = 'error'
    } finally {
      stop()
    }
  }

  /** Error-view fallback: open the official VICE page in the browser (the old manual
   *  route), so the user can download by hand and then link the folder. */
  async function onboardingOpenPage(): Promise<void> {
    await window.breadcraft.settings.openViceDownload()
  }

  /** Error-view: go back to the three choices to try again or pick another route. */
  function onboardingBackToChoices(): void {
    onboardingPhase.value = 'idle'
    onboardingError.value = null
  }

  /** "Later": leave VICE unset — the app stays fully usable — and don't nag again. */
  async function onboardingLater(): Promise<void> {
    await closeOnboarding(true)
  }

  /** Re-check the drafted VICE path so the UI can show a status hint. Any manual/auto
   *  change to the path clears the one-off note (it referred to the previous action). */
  async function revalidateVice(): Promise<void> {
    viceNote.value = null
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
    section,
    viceNote,
    appVersion,
    onboardingOpen,
    onboardingDetected,
    onboardingNote,
    onboardingPhase,
    onboardingPercent,
    onboardingError,
    refresh,
    openModal,
    cancel,
    apply,
    browseVice,
    autoDetectVice,
    revalidateVice,
    openOnboarding,
    maybeOpenOnboarding,
    onboardingUseDetected,
    onboardingLink,
    onboardingDownload,
    onboardingOpenPage,
    onboardingBackToChoices,
    onboardingLater
  }
})

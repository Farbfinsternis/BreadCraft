import { createI18n } from 'vue-i18n'
import type { Locale } from '@shared/ipc'
import { buildLangMessages } from './ssotMessages'
import uiDe from './messages/ui.de.json'
import uiEn from './messages/ui.en.json'
import langDe from './messages/lang.de.json'
import langEn from './messages/lang.en.json'

/**
 * The IDE's single i18n engine (vue-i18n). One merged message tree per locale
 * covers BOTH worlds (memory: breadcraft-localization):
 *   - UI strings   → ui.<locale>.json (authored in German, the source language)
 *   - SSOT vocabulary → lang.<locale>.json, validated against the i18nKeys the
 *     SSOT declares (buildLangMessages).
 *
 * Deutsch is the source language, but English is the *fallback*: a missing key
 * resolves to English, matching the first-run rule "only German ⇒ de, anything
 * else ⇒ en". The active locale itself is resolved in the main process from the
 * persisted config / OS locale and pushed in via setLocale() on boot.
 */
function messagesFor(ui: Record<string, string>, langTexts: Record<string, string>) {
  return { ...ui, ...buildLangMessages(langTexts) }
}

export const i18n = createI18n({
  legacy: false,
  locale: 'en', // provisional; main process resolves the real locale on boot
  fallbackLocale: 'en',
  // Keys carry literal dots (color.black, toolbar.run); vue-i18n matches them
  // flat — verified. A missing key falls back to English.
  messages: {
    de: messagesFor(uiDe, langDe),
    en: messagesFor(uiEn, langEn)
  }
})

/** Switch the active UI language at runtime (Settings change / boot). */
export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale
}

/** Plain (non-component) translation helper for stores / scripts. */
export function t(key: string, named?: Record<string, unknown>): string {
  return i18n.global.t(key, named ?? {})
}

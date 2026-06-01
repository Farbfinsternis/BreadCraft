import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { persistPlugin } from './stores/persist'
import { i18n, setLocale } from './i18n'
import './assets/main.css'

const pinia = createPinia()
pinia.use(persistPlugin)

const app = createApp(App)
app.use(pinia)
app.use(router)
app.use(i18n)

// Resolve the real UI language before showing anything: the main process returns
// the persisted choice, or — on first run — derives it from the OS locale
// (German ⇒ 'de', anything else / undetectable ⇒ 'en') and persists it.
window.breadcraft.settings
  .language()
  .then((locale) => setLocale(locale))
  .catch(() => {
    /* keep the 'en' default if the channel fails */
  })
  .finally(() => app.mount('#app'))

import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@transpiler': resolve('src/transpiler')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    // Monaco's editor worker is bundled locally via a Vite `?worker` import in
    // src/renderer/src/monaco/setup.ts (no CDN) — fits the strict CSP and the
    // "app is the only entry point" rule. We only need the core editor worker
    // for .crumb (no TS/JSON/CSS language services), so no extra plugin.
    worker: { format: 'es' },
    plugins: [vue()]
  }
})

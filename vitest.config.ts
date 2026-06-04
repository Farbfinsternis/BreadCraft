import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Test runner for the transpiler (and any other pure-logic modules). Mirrors the
// path aliases from electron.vite.config.ts so test code imports the same way the
// app does. Node environment — no DOM needed for the lexer/parser.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@transpiler': resolve(__dirname, 'src/transpiler'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})

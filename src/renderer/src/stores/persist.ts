import type { PiniaPluginContext } from 'pinia'

/**
 * Generic persistence plugin (project rule: persist everything that can survive
 * a restart — see _plans memory `breadcraft-persistence-rule`).
 *
 * A store opts in by exposing `persist: { key, paths }` in its options. On every
 * mutation the listed paths are written to localStorage under the given key.
 * Initial hydration is done by each store reading localStorage in its setup, so
 * this plugin only handles the write side.
 */
export interface PersistOptions {
  key: string
  paths: string[]
}

declare module 'pinia' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface DefineStoreOptionsBase<S, Store> {
    persist?: PersistOptions
  }
}

export function persistPlugin({ store, options }: PiniaPluginContext): void {
  const persist = options.persist
  if (!persist) return

  store.$subscribe(() => {
    const snapshot: Record<string, unknown> = {}
    for (const path of persist.paths) {
      snapshot[path] = (store.$state as Record<string, unknown>)[path]
    }
    try {
      localStorage.setItem(persist.key, JSON.stringify(snapshot))
    } catch {
      // storage full / unavailable — non-fatal for UI state
    }
  })
}

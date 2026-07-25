import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePanelsStore } from './panels'

/**
 * A floating panel must never climb over a dialog (user, 2026-07-25).
 *
 * Raise-on-touch handed out an ever-growing number, one per click. Dialogs sit at
 * z-index 120, so after about a hundred touches — one afternoon of painting — the panels
 * were ON TOP of them: the "save as…" window was still drawn, but a panel lay over its
 * name field and swallowed every click and keystroke. It looked like a broken text field.
 * Because the numbers are persisted, it stayed broken across restarts.
 */
const DIALOG_Z = 120

const DEFAULTS = {
  tools: { x: 0, y: 0, width: 100, height: 100 },
  palette: { x: 0, y: 0, width: 100, height: 100 },
  tiles: { x: 0, y: 0, width: 100, height: 100 }
}

describe('floating panels stay under the dialogs', () => {
  // The suite runs in plain node; the store reads a persisted layout on creation, so it
  // needs somewhere to read it from.
  beforeEach(() => {
    const mem = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear()
    }
    setActivePinia(createPinia())
  })

  it('an afternoon of clicking never lifts a panel to the dialog layer', () => {
    const panels = usePanelsStore()
    panels.ensure('tilemap', DEFAULTS)

    // The number of touches that used to break it, several times over.
    for (let i = 0; i < 500; i++) {
      panels.raise('tilemap', i % 2 === 0 ? 'tools' : 'palette')
    }

    for (const id of Object.keys(DEFAULTS)) {
      expect(panels.rect('tilemap', id)!.z).toBeLessThan(DIALOG_Z)
    }
  })

  it('raising still puts that panel on top of its neighbours', () => {
    const panels = usePanelsStore()
    panels.ensure('tilemap', DEFAULTS)

    panels.raise('tilemap', 'tools')
    const tools = panels.rect('tilemap', 'tools')!.z
    expect(tools).toBeGreaterThan(panels.rect('tilemap', 'palette')!.z)
    expect(tools).toBeGreaterThan(panels.rect('tilemap', 'tiles')!.z)

    panels.raise('tilemap', 'tiles')
    expect(panels.rect('tilemap', 'tiles')!.z).toBeGreaterThan(panels.rect('tilemap', 'tools')!.z)
  })

  it('repairs a layout saved with the old runaway numbers', () => {
    // What a real localStorage looked like after a long session.
    localStorage.setItem(
      'breadcraft.panels',
      JSON.stringify({
        rects: {
          'tilemap.tools': { x: 0, y: 0, width: 100, height: 100, z: 347 },
          'tilemap.palette': { x: 0, y: 0, width: 100, height: 100, z: 349 },
          'tilemap.tiles': { x: 0, y: 0, width: 100, height: 100, z: 348 }
        }
      })
    )
    const panels = usePanelsStore()
    panels.ensure('tilemap', DEFAULTS)

    // Opening the editor is enough to bring them back under the dialogs…
    for (const id of Object.keys(DEFAULTS)) {
      expect(panels.rect('tilemap', id)!.z).toBeLessThan(DIALOG_Z)
    }
    // …and the order the user arranged is kept: palette was on top, tools at the bottom.
    expect(panels.rect('tilemap', 'palette')!.z).toBeGreaterThan(panels.rect('tilemap', 'tiles')!.z)
    expect(panels.rect('tilemap', 'tiles')!.z).toBeGreaterThan(panels.rect('tilemap', 'tools')!.z)
  })
})

import { BrowserWindow, screen } from 'electron'
import { readConfig, writeConfig } from './config'
import type { WindowState } from '../shared/ipc'

// Persist & restore the main window's geometry across restarts (project rule:
// persist everything that survives a restart — memory breadcraft-persistence-rule).
// Stored via config.ts (the one userData JSON), so no extra dependency.

const DEFAULT_SIZE = { width: 1440, height: 900 }

/** Window options derived from the last saved state, clamped to a visible display.
 *  Returns just the geometry bits to spread into `new BrowserWindow({...})`. */
export function savedWindowOptions(): {
  x?: number
  y?: number
  width: number
  height: number
} {
  const state = readConfig().windowState
  if (!state) return { ...DEFAULT_SIZE }

  // Guard against an off-screen position (e.g. a monitor was unplugged): only
  // honour x/y if the saved rect still intersects some display's work area.
  let x = state.x
  let y = state.y
  if (x !== undefined && y !== undefined) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        x! < a.x + a.width &&
        x! + state.width > a.x &&
        y! < a.y + a.height &&
        y! + state.height > a.y
      )
    })
    if (!visible) {
      x = undefined
      y = undefined
    }
  }

  return { x, y, width: state.width, height: state.height }
}

/** Whether the last session ended maximized — call after creating the window. */
export function shouldStartMaximized(): boolean {
  return readConfig().windowState?.maximized ?? false
}

/** Wire a window so its geometry is saved on every relevant change. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const save = (): void => {
    if (win.isDestroyed()) return
    // `getBounds()` while maximized returns the maximized rect; we want the NORMAL
    // bounds so un-maximizing later restores the right small size.
    const bounds = win.getNormalBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized()
    }
    writeConfig({ windowState: state })
  }

  // Debounce resize/move (they fire rapidly during a drag).
  const debouncedSave = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 300)
  }

  win.on('resize', debouncedSave)
  win.on('move', debouncedSave)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}

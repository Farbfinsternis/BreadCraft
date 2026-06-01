/**
 * PixelEngine — the headless facade the editor shells talk to (memory
 * breadcraft-pixel-engine, PETSCII_EDITOR.md §8.2). Holds a PixelGrid + History
 * and applies tools as discrete strokes so a freehand drag becomes ONE undo step.
 *
 * No Vue. The Vue <PixelCanvas> drives this with pointer events; everything here
 * is plain TypeScript and Vitest-testable without a DOM.
 */

import { PixelGrid, type CellChange, type PixelIndex } from './grid'
import { History } from './history'
import { drawPixel, fill, line, rect } from './tools'

export type ToolId = 'draw' | 'line' | 'rect' | 'rectFill' | 'fill'

export { PixelGrid } from './grid'
export type { CellChange, PixelIndex } from './grid'

export class PixelEngine {
  readonly grid: PixelGrid
  private history = new History()

  /** Accumulates the current stroke's changes (across drag moves). */
  private strokeChanges: CellChange[] = []
  private stroking = false
  /** For line/rect previews: where the stroke began. */
  private startX = 0
  private startY = 0

  constructor(width: number, height: number, cells?: Uint8Array) {
    this.grid = new PixelGrid(width, height, cells)
  }

  get canUndo(): boolean {
    return this.history.canUndo
  }
  get canRedo(): boolean {
    return this.history.canRedo
  }

  /**
   * Begin a stroke at (x,y) with `tool` painting `value`. For draw/fill the
   * effect lands immediately; for line/rect the first point is just remembered
   * and the shape is drawn on subsequent move/commit. Returns the changes so far.
   */
  begin(tool: ToolId, x: number, y: number, value: PixelIndex): CellChange[] {
    this.stroking = true
    this.startX = x
    this.startY = y
    this.strokeChanges = []

    if (tool === 'draw') return this.extend(drawPixel(this.grid, x, y, value))
    if (tool === 'fill') return this.extend(fill(this.grid, x, y, value))
    // line/rect: nothing visible until move/commit.
    return []
  }

  /**
   * Continue a stroke to (x,y). For `draw` this paints the new cell (freehand).
   * For line/rect this re-previews the shape from the start point: it first
   * reverts the in-progress preview, then redraws to the new endpoint, so the
   * net stroke stays a single clean undo step. Returns the cells that changed
   * versus the previous frame (for incremental rendering by the caller).
   */
  move(tool: ToolId, x: number, y: number, value: PixelIndex): CellChange[] {
    if (!this.stroking) return []

    if (tool === 'draw') {
      return this.extend(drawPixel(this.grid, x, y, value))
    }

    // line/rect/rectFill: undo the current preview, then draw the new one.
    const reverted = this.revertStroke()
    let drawn: CellChange[]
    if (tool === 'line') {
      drawn = line(this.grid, this.startX, this.startY, x, y, value)
    } else {
      drawn = rect(this.grid, this.startX, this.startY, x, y, value, tool === 'rectFill')
    }
    this.strokeChanges = drawn
    // The caller needs every cell touched this frame: the reverted ones (back to
    // their old value) plus the freshly drawn ones.
    return mergeFrame(reverted, drawn)
  }

  /** Finish the current stroke and commit it to history. */
  end(): void {
    if (!this.stroking) return
    this.stroking = false
    this.history.push(this.strokeChanges)
    this.strokeChanges = []
  }

  /** Undo the last committed stroke; returns its changes (reverted) or null. */
  undo(): CellChange[] | null {
    return this.history.undo(this.grid)
  }

  /** Redo the last undone stroke; returns its changes (re-applied) or null. */
  redo(): CellChange[] | null {
    return this.history.redo(this.grid)
  }

  /** Replace the grid contents and reset history (e.g. switching characters). */
  load(cells: Uint8Array): void {
    this.grid.load(cells)
    this.history.clear()
    this.stroking = false
    this.strokeChanges = []
  }

  /** Append changes to the active stroke and return them (for chaining). */
  private extend(changes: CellChange[]): CellChange[] {
    for (const c of changes) this.strokeChanges.push(c)
    return changes
  }

  /** Revert the in-progress stroke's changes on the grid; returns the reverts. */
  private revertStroke(): CellChange[] {
    const reverts: CellChange[] = []
    for (let i = this.strokeChanges.length - 1; i >= 0; i--) {
      const c = this.strokeChanges[i]
      this.grid.applyPrev(c)
      reverts.push(c)
    }
    this.strokeChanges = []
    return reverts
  }
}

/**
 * Merge a frame's reverted cells with the freshly drawn ones so each cell appears
 * once with its final state. Drawn wins over reverted (same cell re-painted).
 */
function mergeFrame(reverted: CellChange[], drawn: CellChange[]): CellChange[] {
  const byKey = new Map<string, CellChange>()
  for (const c of reverted) byKey.set(`${c.x},${c.y}`, c)
  for (const c of drawn) byKey.set(`${c.x},${c.y}`, c)
  return [...byKey.values()]
}

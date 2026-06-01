/**
 * Undo/Redo stack for the pixel engine (PETSCII_EDITOR.md §8.3). One step = one
 * "stroke" = the CellChanges of a single tool action (a whole freehand drag is
 * ONE step, not 30). Session-only — deliberately NOT persisted across restart
 * (Plan §6). Headless: operates on a PixelGrid via its apply* methods.
 */

import type { CellChange, PixelGrid } from './grid'

export class History {
  /** Past strokes (most recent last) available to undo. */
  private undoStack: CellChange[][] = []
  /** Strokes undone and available to redo (cleared on a new stroke). */
  private redoStack: CellChange[][] = []

  /** Record a completed stroke. No-op strokes (no changes) are ignored. */
  push(changes: CellChange[]): void {
    if (changes.length === 0) return
    this.undoStack.push(changes)
    this.redoStack = [] // a fresh edit invalidates the redo branch
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Undo the last stroke on `grid`; returns its changes (for partial re-render). */
  undo(grid: PixelGrid): CellChange[] | null {
    const stroke = this.undoStack.pop()
    if (!stroke) return null
    // Revert in reverse order so overlapping cells restore correctly.
    for (let i = stroke.length - 1; i >= 0; i--) grid.applyPrev(stroke[i])
    this.redoStack.push(stroke)
    return stroke
  }

  /** Redo the last undone stroke on `grid`; returns its changes. */
  redo(grid: PixelGrid): CellChange[] | null {
    const stroke = this.redoStack.pop()
    if (!stroke) return null
    for (const change of stroke) grid.applyNext(change)
    this.undoStack.push(stroke)
    return stroke
  }

  /** Drop all history (e.g. when loading a different character). */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}

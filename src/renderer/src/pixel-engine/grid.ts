/**
 * PixelGrid — the abstract W×H drawing surface shared by every pixel editor
 * (PETSCII 8×8, Sprite 24×21, later Bitmap). Headless: no Vue, no colours, no
 * hardware knowledge — just a grid of colour INDICES 0–3 (memory
 * breadcraft-pixel-engine, PETSCII_EDITOR.md §8.1).
 *
 *   - Hi-Res  uses only 0/1 (background / foreground, 1 bit).
 *   - Multicolor uses 0–3 (4 colour sources, 2 bit).
 *
 * The editor *shell* maps an index to a pen role (bg/s1/s2/free) and then to a
 * hex colour; the engine stays index-only so Sprite/Bitmap can reuse it verbatim.
 */

/** A colour index a cell can hold. 0–1 in hi-res, 0–3 in multicolor. */
export type PixelIndex = 0 | 1 | 2 | 3

/** One changed cell, returned by tools so callers can render/undo just the delta. */
export interface CellChange {
  x: number
  y: number
  /** Index before the change (for undo). */
  prev: PixelIndex
  /** Index after the change. */
  next: PixelIndex
}

export class PixelGrid {
  readonly width: number
  readonly height: number
  /** Row-major cells, length = width*height, each value a PixelIndex. */
  private cells: Uint8Array

  constructor(width: number, height: number, cells?: Uint8Array) {
    this.width = width
    this.height = height
    this.cells = cells ?? new Uint8Array(width * height)
  }

  /** True if (x,y) is inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  private idx(x: number, y: number): number {
    return y * this.width + x
  }

  /** Read a cell (0 for out-of-bounds, so tools can sample freely). */
  get(x: number, y: number): PixelIndex {
    if (!this.inBounds(x, y)) return 0
    return this.cells[this.idx(x, y)] as PixelIndex
  }

  /**
   * Write a cell. Returns the CellChange if the value actually changed, else
   * null — so tools naturally skip no-op writes (keeps undo steps tight).
   */
  set(x: number, y: number, value: PixelIndex): CellChange | null {
    if (!this.inBounds(x, y)) return null
    const i = this.idx(x, y)
    const prev = this.cells[i] as PixelIndex
    if (prev === value) return null
    this.cells[i] = value
    return { x, y, prev, next: value }
  }

  /** Apply a change's `next` (redo) — used by the history stack. */
  applyNext(change: CellChange): void {
    if (this.inBounds(change.x, change.y)) this.cells[this.idx(change.x, change.y)] = change.next
  }

  /** Apply a change's `prev` (undo) — used by the history stack. */
  applyPrev(change: CellChange): void {
    if (this.inBounds(change.x, change.y)) this.cells[this.idx(change.x, change.y)] = change.prev
  }

  /** A copy of the raw cells (e.g. for the renderer to read without mutating). */
  snapshot(): Uint8Array {
    return this.cells.slice()
  }

  /** Replace all cells (e.g. when switching the selected character). */
  load(cells: Uint8Array): void {
    if (cells.length !== this.cells.length) {
      throw new Error(`PixelGrid.load: expected ${this.cells.length} cells, got ${cells.length}`)
    }
    this.cells = cells.slice()
  }

  /** A deep copy of this grid. */
  clone(): PixelGrid {
    return new PixelGrid(this.width, this.height, this.cells.slice())
  }
}

import { describe, it, expect } from 'vitest'
import { PixelGrid } from './grid'
import { drawPixel, fill, line, rect } from './tools'
import { History } from './history'
import { PixelEngine } from './index'

describe('PixelGrid', () => {
  it('starts all-zero and reads out-of-bounds as 0', () => {
    const g = new PixelGrid(8, 8)
    expect(g.get(0, 0)).toBe(0)
    expect(g.get(-1, 0)).toBe(0)
    expect(g.get(8, 8)).toBe(0)
  })

  it('set returns a change only when the value differs', () => {
    const g = new PixelGrid(8, 8)
    expect(g.set(2, 3, 1)).toEqual({ x: 2, y: 3, prev: 0, next: 1 })
    expect(g.set(2, 3, 1)).toBeNull() // no-op
    expect(g.get(2, 3)).toBe(1)
  })

  it('clone is independent', () => {
    const g = new PixelGrid(8, 8)
    g.set(1, 1, 2)
    const c = g.clone()
    c.set(1, 1, 3)
    expect(g.get(1, 1)).toBe(2)
    expect(c.get(1, 1)).toBe(3)
  })

  it('load rejects a mismatched cell count', () => {
    const g = new PixelGrid(8, 8)
    expect(() => g.load(new Uint8Array(10))).toThrow()
  })
})

describe('tools', () => {
  it('drawPixel sets one cell', () => {
    const g = new PixelGrid(8, 8)
    const changes = drawPixel(g, 4, 4, 3)
    expect(changes).toHaveLength(1)
    expect(g.get(4, 4)).toBe(3)
  })

  it('line draws a straight horizontal run inclusive of both ends', () => {
    const g = new PixelGrid(8, 8)
    line(g, 1, 0, 5, 0, 1)
    for (let x = 1; x <= 5; x++) expect(g.get(x, 0)).toBe(1)
    expect(g.get(0, 0)).toBe(0)
    expect(g.get(6, 0)).toBe(0)
  })

  it('rect outline leaves the interior empty; filled rect does not', () => {
    const outline = new PixelGrid(8, 8)
    rect(outline, 1, 1, 4, 4, 1, false)
    expect(outline.get(1, 1)).toBe(1) // corner
    expect(outline.get(2, 2)).toBe(0) // interior empty

    const filled = new PixelGrid(8, 8)
    rect(filled, 1, 1, 4, 4, 1, true)
    expect(filled.get(2, 2)).toBe(1) // interior filled
  })

  it('fill floods the connected region of the same index', () => {
    const g = new PixelGrid(4, 4)
    // Draw a vertical wall at x=2 splitting the grid.
    for (let y = 0; y < 4; y++) g.set(2, y, 1)
    fill(g, 0, 0, 3)
    // Left of the wall becomes 3; the wall and right side stay.
    expect(g.get(0, 0)).toBe(3)
    expect(g.get(1, 3)).toBe(3)
    expect(g.get(2, 0)).toBe(1) // wall untouched
    expect(g.get(3, 0)).toBe(0) // right side untouched
  })

  it('fill is a no-op when the start already equals the value', () => {
    const g = new PixelGrid(4, 4)
    expect(fill(g, 0, 0, 0)).toHaveLength(0)
  })
})

describe('History', () => {
  it('undo/redo restore prior grid state', () => {
    const g = new PixelGrid(4, 4)
    const h = new History()
    const stroke = drawPixel(g, 1, 1, 2)
    h.push(stroke)
    expect(g.get(1, 1)).toBe(2)

    h.undo(g)
    expect(g.get(1, 1)).toBe(0)
    expect(h.canRedo).toBe(true)

    h.redo(g)
    expect(g.get(1, 1)).toBe(2)
  })

  it('a new stroke clears the redo branch', () => {
    const g = new PixelGrid(4, 4)
    const h = new History()
    h.push(drawPixel(g, 0, 0, 1))
    h.undo(g)
    expect(h.canRedo).toBe(true)
    h.push(drawPixel(g, 1, 1, 1))
    expect(h.canRedo).toBe(false)
  })

  it('ignores empty strokes', () => {
    const h = new History()
    h.push([])
    expect(h.canUndo).toBe(false)
  })
})

describe('PixelEngine — stroke lifecycle', () => {
  it('a freehand drag is a single undo step', () => {
    const e = new PixelEngine(8, 8)
    e.begin('draw', 0, 0, 1)
    e.move('draw', 1, 0, 1)
    e.move('draw', 2, 0, 1)
    e.end()
    expect(e.grid.get(0, 0)).toBe(1)
    expect(e.grid.get(2, 0)).toBe(1)

    e.undo() // one undo wipes the whole drag
    expect(e.grid.get(0, 0)).toBe(0)
    expect(e.grid.get(1, 0)).toBe(0)
    expect(e.grid.get(2, 0)).toBe(0)
    expect(e.canUndo).toBe(false)
  })

  it('line preview re-renders to the latest endpoint as a single stroke', () => {
    const e = new PixelEngine(8, 8)
    e.begin('line', 0, 0, 1)
    e.move('line', 3, 0, 1) // preview to x=3
    e.move('line', 5, 0, 1) // user drags further to x=5
    e.end()
    // Only the final line (0..5) should remain; the x=1..3 preview was reverted.
    for (let x = 0; x <= 5; x++) expect(e.grid.get(x, 0)).toBe(1)
    expect(e.grid.get(6, 0)).toBe(0)

    e.undo() // single step clears the whole line
    for (let x = 0; x <= 5; x++) expect(e.grid.get(x, 0)).toBe(0)
  })

  it('rect preview shrinks correctly when the drag pulls back', () => {
    const e = new PixelEngine(8, 8)
    e.begin('rect', 0, 0, 1)
    e.move('rect', 5, 5, 1) // big preview
    e.move('rect', 2, 2, 1) // pull back to a smaller rect
    e.end()
    // The 5×5 preview must be gone; only the 0,0..2,2 outline remains.
    expect(e.grid.get(0, 0)).toBe(1)
    expect(e.grid.get(2, 2)).toBe(1)
    expect(e.grid.get(1, 1)).toBe(0) // interior of outline
    expect(e.grid.get(5, 5)).toBe(0) // old preview corner cleared
  })

  it('rectFill fills the interior as a single stroke', () => {
    const e = new PixelEngine(8, 8)
    e.begin('rectFill', 1, 1, 1)
    e.move('rectFill', 4, 4, 1)
    e.end()
    // Whole 1,1..4,4 block is filled, including the interior.
    for (let y = 1; y <= 4; y++) {
      for (let x = 1; x <= 4; x++) expect(e.grid.get(x, y)).toBe(1)
    }
    expect(e.grid.get(0, 0)).toBe(0) // outside untouched

    e.undo() // one step clears the whole filled rect
    expect(e.grid.get(2, 2)).toBe(0)
  })

  it('load replaces contents and clears history', () => {
    const e = new PixelEngine(2, 2)
    e.begin('draw', 0, 0, 1)
    e.end()
    expect(e.canUndo).toBe(true)
    e.load(new Uint8Array([2, 2, 2, 2]))
    expect(e.grid.get(1, 1)).toBe(2)
    expect(e.canUndo).toBe(false)
  })
})

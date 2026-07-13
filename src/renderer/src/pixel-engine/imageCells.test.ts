import { describe, it, expect } from 'vitest'
import {
  CELL_W,
  CELL_H,
  MAX_CELL_COLORS,
  cellOf,
  cellColors,
  cellOverBudget,
  countClashCells,
  reconcileCells,
  cellsInBox
} from './imageCells'

// A small stand-in image: 8 wide (= 2 cells across) × 8 tall (= 1 cell down).
const W = 8
const H = 8
const BG = 0

/** Paint one logical pixel in a fresh buffer helper. */
function make(): Uint8Array {
  return new Uint8Array(W * H)
}

/** A 16-entry rgb palette where colour i is a distinct grey — nearest-colour ties
 *  resolve by numeric closeness, which keeps the reconcile tests predictable. */
const RGB = Array.from({ length: 16 }, (_, i) => [i * 16, i * 16, i * 16] as const)

describe('cell geometry', () => {
  it('maps pixels to their 4×8 character cell', () => {
    expect(cellOf(0, 0)).toEqual({ col: 0, row: 0 })
    expect(cellOf(3, 7)).toEqual({ col: 0, row: 0 })
    expect(cellOf(CELL_W, 0)).toEqual({ col: 1, row: 0 })
    expect(cellOf(0, CELL_H)).toEqual({ col: 0, row: 1 })
  })
})

describe('cellColors + budget', () => {
  it('ignores the background colour and counts distinct cell-own colours', () => {
    const buf = make()
    buf[0] = 5
    buf[1] = 5
    buf[2] = 7
    expect(cellColors(buf, W, 0, 0, BG)).toEqual([5, 7]) // 5 used twice → first
    expect(cellOverBudget(buf, W, 0, 0, BG)).toBe(false)
  })

  it('flags a cell that uses more than 3 cell-own colours as over budget', () => {
    const buf = make()
    buf[0] = 2
    buf[1] = 3
    buf[2] = 4
    buf[3] = 5 // 4th non-bg colour → clash
    expect(cellColors(buf, W, 0, 0, BG).length).toBe(MAX_CELL_COLORS + 1)
    expect(cellOverBudget(buf, W, 0, 0, BG)).toBe(true)
  })

  it('counts every over-budget cell across the image', () => {
    const buf = make()
    // Cell (0,0): 4 colours → clash. Cell (1,0): 2 colours → legal.
    buf[0] = 2
    buf[1] = 3
    buf[2] = 4
    buf[3] = 5
    buf[CELL_W] = 8
    buf[CELL_W + 1] = 9
    expect(countClashCells(buf, W, H, BG)).toBe(1)
  })
})

describe('reconcileCells (C64-true adaptation)', () => {
  it('leaves a legal cell untouched', () => {
    const buf = make()
    buf[0] = 5
    buf[1] = 7
    const writes = reconcileCells(buf, W, [{ col: 0, row: 0 }], BG, RGB)
    expect(writes).toEqual([])
  })

  it('evicts the least-used 4th colour to its nearest kept colour', () => {
    const buf = make()
    // Colours 2,3,4 each appear twice (kept); colour 15 once (evicted).
    buf[0] = 2
    buf[1] = 2
    buf[2] = 3
    buf[3] = 3
    buf[W + 0] = 4
    buf[W + 1] = 4
    buf[W + 2] = 15 // the lone 4th colour
    const writes = reconcileCells(buf, W, [{ col: 0, row: 0 }], BG, RGB)
    // 15 is greyscale-nearest to kept colour 4 (of {2,3,4,bg=0}); one pixel rewritten.
    expect(writes).toEqual([{ x: 2, y: 1, value: 4 }])
  })

  it('makes the cell C64-legal afterwards', () => {
    const buf = make()
    buf[0] = 2
    buf[1] = 3
    buf[2] = 4
    buf[3] = 5
    buf[W] = 5 // give 5 a second pixel so 2/3/4 are the singletons that get evicted
    for (const wr of reconcileCells(buf, W, [{ col: 0, row: 0 }], BG, RGB)) {
      buf[wr.y * W + wr.x] = wr.value
    }
    expect(cellOverBudget(buf, W, 0, 0, BG)).toBe(false)
  })

  it('deduplicates repeated cells in the input list', () => {
    const buf = make()
    buf[0] = 2
    buf[1] = 3
    buf[2] = 4
    buf[3] = 5
    const once = reconcileCells(buf, W, [{ col: 0, row: 0 }], BG, RGB)
    const twice = reconcileCells(
      buf,
      W,
      [
        { col: 0, row: 0 },
        { col: 0, row: 0 }
      ],
      BG,
      RGB
    )
    expect(twice).toEqual(once)
  })
})

describe('cellsInBox', () => {
  it('returns every cell overlapping a pixel bounding box, clamped', () => {
    expect(cellsInBox(0, 0, 0, 0, W, H)).toEqual([{ col: 0, row: 0 }])
    expect(cellsInBox(3, 0, CELL_W, 0, W, H)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 }
    ])
    // Out-of-range coordinates clamp to the image, never negative/overflow cells.
    expect(cellsInBox(-5, -5, 999, 999, W, H)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 }
    ])
  })
})

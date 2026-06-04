import { describe, it, expect } from 'vitest'
import { drawChar, charPixelHexes, charGridDims, tilePalette } from './charsetRender'

// charsetRender draws an 8×8 character from index data (0–3) to a canvas context.
// Tested with a fake context that records fillStyle + fillRect calls — no DOM.

interface Rect {
  x: number
  y: number
  w: number
  h: number
  color: string
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; rects: Rect[] } {
  const rects: Rect[] = []
  let fillStyle = '#000'
  const ctx = {
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(v: string) {
      fillStyle = v
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, color: fillStyle })
    }
  } as unknown as CanvasRenderingContext2D
  return { ctx, rects }
}

const PALETTE = ['#000000', '#ff0000', '#00ff00', '#0000ff'] // bg, s1, s2, free

describe('charsetRender: drawChar', () => {
  it('draws 64 cells at the given scale and offset', () => {
    const { ctx, rects } = fakeCtx()
    drawChar(ctx, new Uint8Array(64), 10, 20, 3, PALETTE)
    expect(rects.length).toBe(64)
    // first cell at the offset, scale 3
    expect(rects[0]).toMatchObject({ x: 10, y: 20, w: 3, h: 3 })
    // last cell (x=7,y=7) at offset + 7*scale
    expect(rects[63]).toMatchObject({ x: 10 + 7 * 3, y: 20 + 7 * 3 })
  })

  it('maps each index to its palette colour', () => {
    const { ctx, rects } = fakeCtx()
    const cells = new Uint8Array(64)
    cells[0] = 1 // s1 (red)
    cells[1] = 3 // free (blue)
    drawChar(ctx, cells, 0, 0, 1, PALETTE)
    expect(rects[0].color).toBe('#ff0000')
    expect(rects[1].color).toBe('#0000ff')
    expect(rects[2].color).toBe('#000000') // unset → background
  })

  it('treats undefined / short data as all background', () => {
    const { ctx, rects } = fakeCtx()
    drawChar(ctx, undefined, 0, 0, 1, PALETTE)
    expect(rects.length).toBe(64)
    expect(rects.every((r) => r.color === '#000000')).toBe(true)
  })
})

describe('charsetRender: charPixelHexes', () => {
  it('returns 64 css colours mirroring drawChar', () => {
    const cells = new Uint8Array(64)
    cells[5] = 2
    const hexes = charPixelHexes(cells, PALETTE)
    expect(hexes).toHaveLength(64)
    expect(hexes[5]).toBe('#00ff00')
    expect(hexes[0]).toBe('#000000')
  })

  it('falls back to background for out-of-range / missing palette entries', () => {
    const cells = new Uint8Array(64)
    cells[0] = 3
    expect(charPixelHexes(cells, ['#111'])).toContain('#111') // only bg given → idx3 falls back
  })
})

describe('charsetRender: multicolor (4×8 double-wide)', () => {
  it('charGridDims reports 4×8 cells, double-wide, for MC', () => {
    expect(charGridDims(true)).toEqual({ gw: 4, gh: 8, cellW: 2 })
    expect(charGridDims(false)).toEqual({ gw: 8, gh: 8, cellW: 1 })
  })

  it('drawChar fills 32 MC cells, each 2 C64 pixels wide', () => {
    const { ctx, rects } = fakeCtx()
    drawChar(ctx, new Uint8Array(32), 0, 0, 2, PALETTE, true)
    expect(rects.length).toBe(32) // 4×8 cells
    // first cell: 2*scale wide, scale tall
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 4, h: 2 }) // cellW(2)*scale(2)=4 wide, scale(2) tall
    // second cell on row 0 starts at x = cellW*scale = 4
    expect(rects[1]).toMatchObject({ x: 4, y: 0 })
  })

  it('charPixelHexes expands each MC cell to 2 entries → still 64 (8×8 C64 px)', () => {
    const cells = new Uint8Array(32)
    cells[0] = 1 // leftmost double-pixel of row 0 = s1
    const hexes = charPixelHexes(cells, PALETTE, true)
    expect(hexes).toHaveLength(64)
    // the double-wide pixel paints C64 columns 0 AND 1
    expect(hexes[0]).toBe('#ff0000')
    expect(hexes[1]).toBe('#ff0000')
    expect(hexes[2]).toBe('#000000') // next double-pixel is background
  })

  it('MC index 3 (Color-RAM) maps to the free colour like any other index', () => {
    const cells = new Uint8Array(32)
    cells[3] = 3 // rightmost double-pixel of row 0
    const hexes = charPixelHexes(cells, PALETTE, true)
    expect(hexes[6]).toBe('#0000ff')
    expect(hexes[7]).toBe('#0000ff')
  })
})

describe('charsetRender: per-cell Color-RAM override (M2.T2)', () => {
  it('tilePalette substitutes index 3 with the Color-RAM colour in MC', () => {
    const p = tilePalette(PALETTE, true, '#abcdef')
    expect(p[3]).toBe('#abcdef')
    expect(p[0]).toBe(PALETTE[0]) // others untouched
    expect(p[1]).toBe(PALETTE[1])
  })

  it('tilePalette leaves the palette alone in hi-res or without an override', () => {
    expect(tilePalette(PALETTE, false, '#abcdef')).toBe(PALETTE) // hi-res: unchanged
    expect(tilePalette(PALETTE, true, undefined)).toBe(PALETTE) // no override
  })

  it('drawChar paints MC index-3 cells in the given Color-RAM colour', () => {
    const { ctx, rects } = fakeCtx()
    const cells = new Uint8Array(32)
    cells[0] = 3 // leftmost double-pixel = Color-RAM
    drawChar(ctx, cells, 0, 0, 1, PALETTE, true, '#abcdef')
    expect(rects[0].color).toBe('#abcdef') // the cell's Color-RAM colour, not PALETTE[3]
    expect(rects[1].color).toBe('#000000') // next cell still background
  })
})

import { describe, it, expect } from 'vitest'
import {
  fitZoom,
  maxPan,
  clampPan,
  viewOffset,
  mapPixelAt,
  zoomAt,
  rowEdgeAtScreenY
} from './map-viewport'

// S1.B2.T2, the free map canvas. The whole feel of the editor rides on this arithmetic:
// a wrong sign and the level runs away under the cursor. One screen is 320×200 map
// pixels; a three-screen level is 960×200.

const ONE = { canvasW: 320, canvasH: 200 }
const WIDE = { canvasW: 960, canvasH: 200 }
const PANEL = { viewW: 640, viewH: 400 }

describe('map viewport: fitting', () => {
  it('fits by the tighter axis, so nothing is cut off', () => {
    // A 640×400 panel is exactly 2× one screen in both directions.
    expect(fitZoom(640, 400, ONE.canvasW, ONE.canvasH)).toBe(2)
    // The same panel holds only a third as much of a three-screen level.
    expect(fitZoom(640, 400, WIDE.canvasW, WIDE.canvasH)).toBeCloseTo(640 / 960)
  })

  it('never divides by an unmeasured panel', () => {
    expect(fitZoom(0, 0, 320, 200)).toBe(1)
  })
})

describe('map viewport: panning limits', () => {
  it('cannot be pushed past the map edge', () => {
    // At 1× a 640-wide window shows 640 of the 960 map pixels → 320 left to travel.
    expect(maxPan(640, 960, 1)).toBe(320)
    expect(clampPan(9999, 640, 960, 1)).toBe(320)
    expect(clampPan(-50, 640, 960, 1)).toBe(0)
  })

  it('has nothing to pan while the map fits — it is centred instead', () => {
    expect(maxPan(640, 320, 1)).toBe(0)
    // 320 map pixels at 1× inside a 640 window → 160 px of margin on each side.
    expect(viewOffset(640, 320, 1, 0)).toBe(160)
    // And a pan value cannot budge that centred map.
    expect(viewOffset(640, 320, 1, 200)).toBe(160)
  })

  it('hangs a bigger map on its pan position', () => {
    expect(viewOffset(640, 960, 1, 0)).toBeCloseTo(0)
    expect(viewOffset(640, 960, 1, 100)).toBe(-100)
    expect(viewOffset(640, 960, 2, 100)).toBe(-200) // pan is map pixels, not screen ones
  })

  it('reads back the map pixel under a point (the pan is counted once)', () => {
    // Panned 200 map pixels right at 1×: the window's left edge shows map pixel 200,
    // so 500 px into the window is map pixel 700 — not 900.
    expect(mapPixelAt(500, 640, 960, 1, 200)).toBe(700)
    // Centred map: 160 px of margin, so the window's left edge is BEFORE the map.
    expect(mapPixelAt(160, 640, 320, 1, 0)).toBe(0)
  })
})

// S1.B2.T4: the play-field ruler snaps to whole tile rows, because the C64 scrolls whole
// character rows — a band on half a row does not exist.
describe('map viewport: row edges for the play-field ruler', () => {
  it('snaps to the nearest row edge', () => {
    // 8 px per row at 2× = 16 screen px per row, map starting at y = 100.
    expect(rowEdgeAtScreenY(100, 100, 2, 8, 25)).toBe(0)
    expect(rowEdgeAtScreenY(105, 100, 2, 8, 25)).toBe(0) // nearer the top edge
    expect(rowEdgeAtScreenY(112, 100, 2, 8, 25)).toBe(1) // nearer the next one
    expect(rowEdgeAtScreenY(148, 100, 2, 8, 25)).toBe(3)
  })

  it('stays on the map, however far the hand travels', () => {
    expect(rowEdgeAtScreenY(-9999, 100, 2, 8, 25)).toBe(0)
    expect(rowEdgeAtScreenY(9999, 100, 2, 8, 25)).toBe(25) // the edge below the last row
  })
})

describe('map viewport: zooming toward the cursor', () => {
  const box = { ...PANEL, ...WIDE }

  it('keeps the map pixel under the cursor under the cursor', () => {
    const state = { zoom: 1, panX: 200, panY: 0 }
    const cursorX = 500
    const before = mapPixelAt(cursorX, box.viewW, box.canvasW, state.zoom, state.panX)
    const after = zoomAt(box, state, cursorX, 100, 2)
    const now = mapPixelAt(cursorX, box.viewW, box.canvasW, after.zoom, after.panX)
    expect(now).toBeCloseTo(before)
  })

  it('holds the anchor when zooming back out too', () => {
    const state = { zoom: 4, panX: 300, panY: 40 }
    const before = mapPixelAt(300, box.viewW, box.canvasW, state.zoom, state.panX)
    const after = zoomAt(box, state, 300, 120, 2)
    expect(mapPixelAt(300, box.viewW, box.canvasW, after.zoom, after.panX)).toBeCloseTo(before)
  })

  // Zooming out far enough that the level fits can NOT hold the anchor — a fitting map
  // is centred, there is no pan left to hold it with. Honest limit, not a bug: the whole
  // level is in view, so nothing is lost.
  it('centres instead of holding the anchor once the map fits', () => {
    const after = zoomAt(box, { zoom: 4, panX: 300, panY: 40 }, 300, 120, 640 / 960)
    expect(after.panX).toBe(0)
  })

  it('leaves no pan behind when zooming out until the map fits', () => {
    const after = zoomAt(box, { zoom: 4, panX: 700, panY: 100 }, 320, 200, 0.5)
    // At 0.5× the whole level fits in the window → nothing left to pan, so it centres
    // rather than sitting on a stale offset.
    expect(after.panX).toBe(0)
    expect(after.panY).toBe(0)
  })

  it('cannot zoom the map out of the window at the far edge', () => {
    const after = zoomAt(box, { zoom: 1, panX: 320, panY: 0 }, 639, 10, 4)
    expect(after.panX).toBeLessThanOrEqual(maxPan(box.viewW, box.canvasW, 4))
    expect(after.panX).toBeGreaterThanOrEqual(0)
  })
})

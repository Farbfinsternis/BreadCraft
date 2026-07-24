/**
 * The arithmetic of the free map canvas (S1.B2.T2) — a window over a landscape that
 * may be many screens wide. Pure functions, no Vue: this is the part that has to be
 * RIGHT (a wrong sign here and the map runs away under the cursor), so it lives where
 * it can be tested instead of inside the component.
 *
 * Two coordinate worlds:
 *  - MAP PIXELS — the canvas' own pixels (a cell is 8 of them). The pan is stored here,
 *    so zooming never teleports the view.
 *  - SCREEN PIXELS — what the user's eye and mouse deal in. `zoom` converts: one map
 *    pixel is `zoom` screen pixels.
 */

/** Zoom at which the whole map fits inside the viewport. */
export function fitZoom(viewW: number, viewH: number, canvasW: number, canvasH: number): number {
  if (viewW <= 0 || viewH <= 0 || canvasW <= 0 || canvasH <= 0) return 1
  return Math.min(viewW / canvasW, viewH / canvasH)
}

/** How far the map may be pushed along one axis before its own edge would leave the
 *  window — 0 while it fits (then it is centred instead of panned). */
export function maxPan(view: number, canvas: number, zoom: number): number {
  return Math.max(0, canvas - view / zoom)
}

/** The stored pan, held inside what the map allows. */
export function clampPan(pan: number, view: number, canvas: number, zoom: number): number {
  return Math.min(Math.max(0, pan), maxPan(view, canvas, zoom))
}

/** Where the map's top-left corner lands on screen: centred while the map is smaller
 *  than the window (the familiar one-screen look), otherwise driven by the pan. */
export function viewOffset(view: number, canvas: number, zoom: number, pan: number): number {
  const scaled = canvas * zoom
  if (scaled <= view) return (view - scaled) / 2
  return -clampPan(pan, view, canvas, zoom) * zoom
}

/** Which map pixel sits under a point in the window. The offset ALREADY carries the
 *  pan (it is the screen position of map pixel 0) — adding the pan again here would
 *  count it twice and make the map bolt away under the cursor while zooming. */
export function mapPixelAt(
  screenPos: number,
  view: number,
  canvas: number,
  zoom: number,
  pan: number
): number {
  return (screenPos - viewOffset(view, canvas, zoom, pan)) / zoom
}

export interface ViewportBox {
  viewW: number
  viewH: number
  canvasW: number
  canvasH: number
}

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}

/**
 * Zoom toward a point in the window: the map pixel under the cursor stays under the
 * cursor. That is what makes it feel like leaning in rather than being teleported —
 * without it, zooming out of a five-screen level loses the spot you were working on.
 */
export function zoomAt(
  box: ViewportBox,
  state: ViewState,
  screenX: number,
  screenY: number,
  nextZoom: number
): ViewState {
  const mx = mapPixelAt(screenX, box.viewW, box.canvasW, state.zoom, state.panX)
  const my = mapPixelAt(screenY, box.viewH, box.canvasH, state.zoom, state.panY)
  // Where the corner would sit at the new zoom if the map is smaller than the window
  // (centred) — the pan cannot move a centred map, so the anchor is that offset.
  const offX = box.canvasW * nextZoom <= box.viewW ? (box.viewW - box.canvasW * nextZoom) / 2 : 0
  const offY = box.canvasH * nextZoom <= box.viewH ? (box.viewH - box.canvasH * nextZoom) / 2 : 0
  return {
    zoom: nextZoom,
    panX: clampPan(mx - (screenX - offX) / nextZoom, box.viewW, box.canvasW, nextZoom),
    panY: clampPan(my - (screenY - offY) / nextZoom, box.viewH, box.canvasH, nextZoom)
  }
}

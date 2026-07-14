/**
 * Image IMPORT (BRONZE B2.T2f) — turn an arbitrary picture (a photo, a painted PNG,
 * an AI-generated "C64-style" image) into a REAL, C64-legal MC-bitmap canvas. Modern
 * models fake the *look* of a C64 picture (fine gradients, true colours, no cell
 * limit); this converter makes the honest thing: a 160×200 buffer where EVERY 8×8
 * cell shows only the shared background + up to 3 cell-own colours from the 16 fixed
 * hardware colours (memory ai-image-to-c64-import). Ported from the verified Python
 * prototype (_intern/c64convert_prototype.py) — same 5-step pipeline.
 *
 * Pure + headless (no Vue, no canvas): the caller does the impure part (decode +
 * cover-crop + resize to 160×200 RGBA via an offscreen <canvas>) and hands us the
 * pixels; we do the perceptual colour work. Palette-agnostic like reconcileCells —
 * the caller passes the 16 fixed C64 RGBs — so the whole thing is Vitest-provable.
 *
 * The pipeline (memory ai-image-to-c64-import):
 *   1. (resample → 160×200 — the CALLER's job, needs a canvas)
 *   2. optional pre-adjust: brightness / contrast / saturation (arbitrary photos need it)
 *   3. map to the 16 C64 colours in CIELAB (perceptual), not raw RGB
 *   4. pick ONE global background (the most-used nearest colour; dark scenes → black)
 *   5. dither GLOBALLY against all 16 colours (Atkinson by default, or Floyd–Steinberg),
 *      so the error flows across cell boundaries — smooth regions come out as one coherent
 *      fabric — THEN legalize each 8×8 cell to background + ≤3 colours. Doing it in this order
 *      (global first, per-cell reduce second — the Retropixels/Multipaint approach) avoids
 *      the per-cell palette seams that make cells "break out" of a dithered gradient.
 *
 * Honest expectation: the result is C64-*like*, not pixel-identical — fine detail and
 * smooth gradients are physically lost (160 wide + 4 colours per cell). Dark, low-tone
 * scenes convert very convincingly.
 */
import { CELL_W, CELL_H, reconcileCells, cellsInBox } from './imageCells'

/** The import target is one full MC-bitmap screen. */
export const IMPORT_W = 160
export const IMPORT_H = 200

type Rgb = readonly [number, number, number]
type Lab = readonly [number, number, number]

/**
 * Error-diffusion dither kernel.
 *  - `atkinson` (default): spreads only 6/8 of the error and DISCARDS 2/8, giving cleaner,
 *    higher-contrast, quieter results on a tiny palette (Apple's Mac dither — the look that
 *    makes 16-colour conversions read well). The right default here.
 *  - `floyd`: classic Floyd–Steinberg (all error diffused) — smoother gradients but muddier
 *    and noisier on 16 colours.
 */
export type DitherMode = 'atkinson' | 'floyd'

export interface ImportOptions {
  /** Turn error-diffusion dithering on. Off = flat nearest-colour mapping. */
  dither?: boolean
  /** Which dither kernel when `dither` is on. Default `atkinson`. */
  ditherMode?: DitherMode
  /** Pre-adjust brightness, −1…+1 (0 = unchanged). Added as `v += brightness*255`. */
  brightness?: number
  /** Pre-adjust contrast, −1…+1 (0 = unchanged). Scales around mid-grey (128). */
  contrast?: number
  /** Pre-adjust saturation, ≥0 (1 = unchanged, 0 = greyscale). */
  saturation?: number
}

export interface ImportResult {
  /** 160×200 canvas, one C64 colour index (0–15) per logical MC pixel. */
  pixels: Uint8Array
  /** The chosen shared background colour ($D021), index 0–15. Every cell is legal
   *  against THIS background (bg + ≤3 others), so the caller must adopt it. */
  background: number
}


// ---- sRGB → CIELAB (D65), for perceptual colour distance ----
function pivot(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

/** Convert an 8-bit sRGB triple to CIELAB (D65 white). */
export function srgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number): number => {
    const v = c / 255
    return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92
  }
  const lr = lin(r)
  const lg = lin(g)
  const lb = lin(b)
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883
  const fx = pivot(x)
  const fy = pivot(y)
  const fz = pivot(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function labDist2(a: Lab, b: Lab): number {
  const dL = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return dL * dL + da * da + db * db
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** Apply brightness / contrast / saturation to one RGB triple (unclamped output). */
function adjust(r: number, g: number, b: number, br: number, co: number, sa: number): Rgb {
  if (br !== 0) {
    const add = br * 255
    r += add
    g += add
    b += add
  }
  if (co !== 0) {
    const k = 1 + co
    r = (r - 128) * k + 128
    g = (g - 128) * k + 128
    b = (b - 128) * k + 128
  }
  if (sa !== 1) {
    const grey = 0.299 * r + 0.587 * g + 0.114 * b
    r = grey + (r - grey) * sa
    g = grey + (g - grey) * sa
    b = grey + (b - grey) * sa
  }
  return [r, g, b]
}

/** Nearest of the 16 fixed colours (in LAB) to a given LAB colour. */
function nearest(lab: Lab, palLab: readonly Lab[]): number {
  let best = Infinity
  let bi = 0
  for (let i = 0; i < palLab.length; i++) {
    const d = labDist2(lab, palLab[i])
    if (d < best) {
      best = d
      bi = i
    }
  }
  return bi
}

/**
 * Convert a 160×200 RGBA buffer (already cover-cropped + resized by the caller) into a
 * C64-legal 16-colour canvas + chosen background. `rgba` is length IMPORT_W*IMPORT_H*4
 * (the alpha channel is ignored). `palRgb` is the 16 fixed C64 colours as [r,g,b].
 *
 * Guarantee: against the returned `background`, EVERY 8×8 cell of `pixels` uses at most
 * 3 non-background colours — i.e. the output is already C64-legal (countClashCells === 0).
 */
export function importImage(
  rgba: ArrayLike<number>,
  palRgb: readonly Rgb[],
  opts: ImportOptions = {}
): ImportResult {
  const dither = opts.dither ?? false
  const ditherMode = opts.ditherMode ?? 'atkinson'
  const br = opts.brightness ?? 0
  const co = opts.contrast ?? 0
  const sa = opts.saturation ?? 1
  const N = IMPORT_W * IMPORT_H

  const palLab = palRgb.map((c) => srgbToLab(c[0], c[1], c[2]))

  // Pre-adjust once → the clamped source RGB. `work` (below) copies this for the dither's
  // error diffusion; the un-dithered adj* stays the reference for the plain path.
  const adjR = new Float64Array(N)
  const adjG = new Float64Array(N)
  const adjB = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const o = i * 4
    const [r, g, b] = adjust(rgba[o], rgba[o + 1], rgba[o + 2], br, co, sa)
    adjR[i] = clamp255(r)
    adjG[i] = clamp255(g)
    adjB[i] = clamp255(b)
  }

  // PHASE A — dither GLOBALLY against all 16 colours (not per cell). This is the key to
  // coherent output: the error flows continuously across cell boundaries, so a smooth
  // region dithers as ONE fabric instead of each cell picking its own palette and the
  // texture jumping at every 8×8 seam (the "cells break out" artefact). Serpentine scan
  // (even rows L→R, odd R→L, kernel mirrored) kills directional worm patterns; the kernel
  // is Atkinson by default (cleaner on a tiny palette). Without dithering this is just a
  // per-pixel nearest-colour map. May leave a cell with >3 non-bg colours — Phase B fixes it.
  const work = dither ? { r: Float64Array.from(adjR), g: Float64Array.from(adjG), b: Float64Array.from(adjB) } : null
  const pixels = new Uint8Array(N)

  for (let y = 0; y < IMPORT_H; y++) {
    const ltr = (y & 1) === 0
    for (let k = 0; k < IMPORT_W; k++) {
      const x = ltr ? k : IMPORT_W - 1 - k
      const i = y * IMPORT_W + x
      const sr = work ? work.r[i] : adjR[i]
      const sg = work ? work.g[i] : adjG[i]
      const sb = work ? work.b[i] : adjB[i]
      const bi = nearest(srgbToLab(clamp255(sr), clamp255(sg), clamp255(sb)), palLab)
      pixels[i] = bi
      if (work) {
        const [cr, cg, cb] = palRgb[bi]
        diffuse(work, x, y, sr - cr, sg - cg, sb - cb, ltr ? 1 : -1, ditherMode)
      }
    }
  }

  // Choose the shared background ($D021) NOW, from the actual dithered image — because the
  // background is the ONE colour free in every cell, it only changes the result in the
  // over-budget cells Phase B reduces. So pick the colour that MINIMISES reconcile damage
  // (fewest evicted pixels): dark, detailed art tends to get a dark background it keeps
  // everywhere; bright art keeps its dominant tone. Content-adaptive, and free.
  const bg = chooseBackground(pixels, palRgb.length)

  // PHASE B — legalize each cell to the C64 budget (background + up to 3 colours). Cells
  // in smooth regions already use ≤ 4, so they pass through untouched (the dithering
  // stays coherent); only genuinely busy cells (> 4 colours) are reduced — the 3 most-used
  // non-background colours are kept and evicted pixels snap to the nearest kept colour.
  const allCells = cellsInBox(0, 0, IMPORT_W - 1, IMPORT_H - 1, IMPORT_W, IMPORT_H)
  for (const wcell of reconcileCells(pixels, IMPORT_W, allCells, bg, palRgb)) {
    pixels[wcell.y * IMPORT_W + wcell.x] = wcell.value
  }

  return { pixels, background: bg }
}

/**
 * Pick the shared background ($D021) that minimises reconcile damage. For each candidate
 * colour, count how many pixels Phase B would EVICT (a cell keeps the background plus its 3
 * most-used other colours; the rest are remapped) if that colour were free everywhere, and
 * take the minimum. Ties break toward the more-present colour. The background only affects
 * over-budget cells, so this directly minimises the visible colour shift from legalisation.
 */
function chooseBackground(pixels: Uint8Array, palLen: number): number {
  const CELLS_X = IMPORT_W / CELL_W
  const CELLS_Y = IMPORT_H / CELL_H
  // Per cell, the per-colour pixel counts (dense over the small palette).
  const cellCounts: number[][] = []
  const total = new Array(palLen).fill(0)
  for (let cy = 0; cy < CELLS_Y; cy++) {
    for (let cx = 0; cx < CELLS_X; cx++) {
      const counts = new Array(palLen).fill(0)
      for (let dy = 0; dy < CELL_H; dy++) {
        for (let dx = 0; dx < CELL_W; dx++) {
          counts[pixels[(cy * CELL_H + dy) * IMPORT_W + (cx * CELL_W + dx)]]++
        }
      }
      cellCounts.push(counts)
      for (let c = 0; c < palLen; c++) total[c] += counts[c]
    }
  }
  let best = 0
  let bestEvicted = Infinity
  for (let bgc = 0; bgc < palLen; bgc++) {
    let evicted = 0
    for (const counts of cellCounts) {
      // Non-background colours present in this cell, most-used first; evict all past the 3rd.
      const others: number[] = []
      for (let c = 0; c < palLen; c++) if (c !== bgc && counts[c] > 0) others.push(counts[c])
      if (others.length <= 3) continue
      others.sort((a, b) => b - a)
      for (let i = 3; i < others.length; i++) evicted += others[i]
    }
    if (evicted < bestEvicted || (evicted === bestEvicted && total[bgc] > total[best])) {
      bestEvicted = evicted
      best = bgc
    }
  }
  return best
}

// Dither kernels as (dx, dy, weight) relative to the current pixel, for a left→right
// pass. `dx` is multiplied by the scan direction so the kernel mirrors on the serpentine's
// return rows. Atkinson's weights sum to 6/8 (it deliberately drops 2/8 of the error →
// crisper, quieter results on a tiny palette); Floyd–Steinberg's sum to 1.
const KERNEL_ATKINSON: readonly (readonly [number, number, number])[] = [
  [1, 0, 1 / 8],
  [2, 0, 1 / 8],
  [-1, 1, 1 / 8],
  [0, 1, 1 / 8],
  [1, 1, 1 / 8],
  [0, 2, 1 / 8]
]
const KERNEL_FLOYD: readonly (readonly [number, number, number])[] = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16]
]

/**
 * Spread a pixel's quantization error to its not-yet-visited neighbours. `dir` is the scan
 * direction (+1 left→right, −1 right→left) so the kernel mirrors on the serpentine's return
 * rows and always pushes error toward pixels still ahead. `mode` picks the kernel.
 */
function diffuse(
  work: { r: Float64Array; g: Float64Array; b: Float64Array },
  x: number,
  y: number,
  er: number,
  eg: number,
  eb: number,
  dir: number,
  mode: DitherMode
): void {
  const kernel = mode === 'floyd' ? KERNEL_FLOYD : KERNEL_ATKINSON
  for (const [dx, dy, fw] of kernel) {
    const nx = x + dx * dir
    const ny = y + dy
    if (nx < 0 || nx >= IMPORT_W || ny < 0 || ny >= IMPORT_H) continue
    const j = ny * IMPORT_W + nx
    work.r[j] += er * fw
    work.g[j] += eg * fw
    work.b[j] += eb * fw
  }
}

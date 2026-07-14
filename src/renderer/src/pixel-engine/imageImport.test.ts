import { describe, it, expect } from 'vitest'
import { importImage, srgbToLab, IMPORT_W, IMPORT_H } from './imageImport'
import { bufferToC64, c64ToBuffer } from './imageBytes'
import { countClashCells } from './imageCells'

/**
 * B2.T2f import pipeline — the guarantee that matters is that ANY input comes out
 * C64-legal: against the chosen background, every 8×8 cell uses ≤3 other colours.
 * That's what makes the imported picture round-trip losslessly through the .image
 * byte planes (bufferToC64 / c64ToBuffer), same as hand-painted legal art.
 */

// The 16 fixed C64 colours (index = hardware number), matching stores/palette.ts.
const C64_HEX = [
  '000000', 'FFFFFF', '68372B', '70A4B2', '6F3D86', '588D43', '352879', 'B8C76F',
  '6F4F25', '433900', '9A6759', '444444', '6C6C6C', '9AD284', '6C5EB5', '959595'
]
const PAL_RGB = C64_HEX.map(
  (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as [number, number, number]
)

/** Build a 160×200 RGBA buffer from a per-pixel colour function. */
function makeRgba(fn: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(IMPORT_W * IMPORT_H * 4)
  for (let y = 0; y < IMPORT_H; y++) {
    for (let x = 0; x < IMPORT_W; x++) {
      const [r, g, b] = fn(x, y)
      const o = (y * IMPORT_W + x) * 4
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = 255
    }
  }
  return rgba
}

describe('importImage', () => {
  it('outputs 160×200 indices in 0–15 and a valid background', () => {
    const rgba = makeRgba((x, y) => [(x * 3) & 255, (y * 5) & 255, (x + y) & 255])
    const { pixels, background } = importImage(rgba, PAL_RGB)
    expect(pixels.length).toBe(IMPORT_W * IMPORT_H)
    expect(background).toBeGreaterThanOrEqual(0)
    expect(background).toBeLessThanOrEqual(15)
    for (const p of pixels) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(15)
    }
  })

  it('an all-black image picks black background and stays all black', () => {
    const rgba = makeRgba(() => [0, 0, 0])
    const { pixels, background } = importImage(rgba, PAL_RGB)
    expect(background).toBe(0)
    expect(pixels.every((p) => p === 0)).toBe(true)
  })

  it('maps a flat exact-C64 colour to that colour', () => {
    // A field of pure C64 white (index 1) on the whole screen.
    const rgba = makeRgba(() => [255, 255, 255])
    const { pixels, background } = importImage(rgba, PAL_RGB)
    // Every pixel is white; background is white (most-used), pixels all white.
    expect(background).toBe(1)
    expect(pixels.every((p) => p === 1)).toBe(true)
  })

  it('GUARANTEE: every cell is C64-legal (≤3 non-background colours) — no dither', () => {
    // A busy gradient that would need far more than 4 colours per cell if left free.
    const rgba = makeRgba((x, y) => [(x * 8) & 255, (y * 6) & 255, ((x ^ y) * 4) & 255])
    const { pixels, background } = importImage(rgba, PAL_RGB, { dither: false })
    expect(countClashCells(pixels, IMPORT_W, IMPORT_H, background)).toBe(0)
  })

  it('GUARANTEE: every cell is C64-legal even WITH dithering', () => {
    const rgba = makeRgba((x, y) => [(x * 8) & 255, (y * 6) & 255, ((x ^ y) * 4) & 255])
    const { pixels, background } = importImage(rgba, PAL_RGB, { dither: true })
    expect(countClashCells(pixels, IMPORT_W, IMPORT_H, background)).toBe(0)
  })

  it('Atkinson and Floyd–Steinberg both stay legal but differ', () => {
    const rgba = makeRgba((x, y) => [(x * 5) & 255, (y * 3) & 255, (x + y) & 255])
    const atk = importImage(rgba, PAL_RGB, { dither: true, ditherMode: 'atkinson' })
    const fs = importImage(rgba, PAL_RGB, { dither: true, ditherMode: 'floyd' })
    expect(countClashCells(atk.pixels, IMPORT_W, IMPORT_H, atk.background)).toBe(0)
    expect(countClashCells(fs.pixels, IMPORT_W, IMPORT_H, fs.background)).toBe(0)
    expect(Array.from(atk.pixels)).not.toEqual(Array.from(fs.pixels))
    // Default dither mode is Atkinson.
    const def = importImage(rgba, PAL_RGB, { dither: true })
    expect(Array.from(def.pixels)).toEqual(Array.from(atk.pixels))
  })

  it('round-trips losslessly through the .image byte planes', () => {
    const rgba = makeRgba((x, y) => [(x * 7) & 255, (y * 9) & 255, (x * y) & 255])
    const { pixels, background } = importImage(rgba, PAL_RGB, { dither: true })
    const { bitmap, screen, color } = bufferToC64(pixels, background)
    const back = c64ToBuffer(bitmap, screen, color, background)
    expect(Array.from(back)).toEqual(Array.from(pixels))
  })

  it('dithering changes the result versus plain quantization on a gradient', () => {
    const rgba = makeRgba((x) => [x, x, x]) // horizontal grey ramp
    const plain = importImage(rgba, PAL_RGB, { dither: false }).pixels
    const dith = importImage(rgba, PAL_RGB, { dither: true }).pixels
    // Both draw from the same per-cell palettes (chosen on the un-dithered image), so
    // dithering redistributes colours WITHIN cells rather than adding new ones — the
    // pixel layout must differ even though the overall colour set can match.
    expect(Array.from(dith)).not.toEqual(Array.from(plain))
  })

  it('dithering breaks a smooth gradient into per-row variation (not flat bands)', () => {
    // Plain quantization of a horizontal ramp gives vertical bands: colour is flat along
    // each row except at band edges → very few in-row changes. Floyd–Steinberg in raster
    // order should scatter colours across each row → many more in-row changes.
    const rgba = makeRgba((x) => [x, x, x])
    const horizChanges = (buf: Uint8Array): number => {
      let n = 0
      for (let y = 0; y < IMPORT_H; y++) {
        for (let x = 1; x < IMPORT_W; x++) {
          if (buf[y * IMPORT_W + x] !== buf[y * IMPORT_W + x - 1]) n++
        }
      }
      return n
    }
    const plain = importImage(rgba, PAL_RGB, { dither: false }).pixels
    const dith = importImage(rgba, PAL_RGB, { dither: true }).pixels
    expect(horizChanges(dith)).toBeGreaterThan(horizChanges(plain) * 3)
  })

  it('dithers a LOW-CONTRAST gradient that would otherwise collapse to one colour', () => {
    // A subtle sky-like ramp: every pixel maps to (nearly) the same nearest C64 colour,
    // so a plain error-min palette would leave each cell flat. The dither-aware palette
    // must pick a bracketing colour so the cell dithers — and stay C64-legal.
    const rgba = makeRgba((x) => {
      const t = x / IMPORT_W
      return [150 + t * 30, 175 + t * 20, 200 + t * 15]
    })
    const { pixels, background } = importImage(rgba, PAL_RGB, { dither: true })
    expect(new Set(pixels).size).toBeGreaterThan(1)
    expect(countClashCells(pixels, IMPORT_W, IMPORT_H, background)).toBe(0)
  })

  it('picks the background that minimises reconcile damage, not the most-used colour', () => {
    // Top half: a big flat white field (dominates the pixel count, but flat cells evict
    // nothing). Bottom half: busy cells (>4 colours) where C64 red dominates. The smart
    // background should serve the cells that actually get reduced → red, not white.
    const busy = [
      [0x68, 0x37, 0x2b], // red (index 2) — most frequent below
      [0x68, 0x37, 0x2b],
      [0x68, 0x37, 0x2b],
      [0x58, 0x8d, 0x43], // green (5)
      [0x35, 0x28, 0x79], // blue (6)
      [0x6f, 0x3d, 0x86], // purple (4)
      [0x70, 0xa4, 0xb2] // cyan (3)
    ]
    const rgba = makeRgba((x, y) => {
      if (y < IMPORT_H / 2) return [255, 255, 255] // flat white top
      return busy[(x * 7 + y * 3) % busy.length] as [number, number, number]
    })
    const { pixels, background } = importImage(rgba, PAL_RGB, { dither: false })
    expect(background).toBe(2) // red — the busy-cell workhorse, not white (most-used)
    expect(countClashCells(pixels, IMPORT_W, IMPORT_H, background)).toBe(0)
  })

  it('does NOT dither a field that is already an exact C64 colour (no noise)', () => {
    // Anti-noise guard: a flat exact-C64 field must stay a single colour — the dither-
    // aware palette gains nothing there (segment distance == point distance).
    const rgba = makeRgba(() => [0x70, 0xa4, 0xb2]) // C64 cyan (index 3), exact
    const { pixels } = importImage(rgba, PAL_RGB, { dither: true })
    expect(new Set(pixels).size).toBe(1)
    expect(pixels[0]).toBe(3)
  })

  it('brightness lifts a mid-grey field toward lighter colours', () => {
    const rgba = makeRgba(() => [100, 100, 100])
    const dark = importImage(rgba, PAL_RGB, { brightness: 0 }).pixels
    const bright = importImage(rgba, PAL_RGB, { brightness: 0.5 }).pixels
    const luma = (buf: Uint8Array): number => {
      let s = 0
      for (const p of buf) {
        const [r, g, b] = PAL_RGB[p]
        s += 0.299 * r + 0.587 * g + 0.114 * b
      }
      return s / buf.length
    }
    expect(luma(bright)).toBeGreaterThan(luma(dark))
  })

  it('saturation 0 collapses colour toward grey', () => {
    // A saturated red field; desaturating should not keep mapping to a red index.
    const rgba = makeRgba(() => [200, 40, 40])
    const grey = importImage(rgba, PAL_RGB, { saturation: 0 }).pixels
    for (const p of grey) {
      const [r, g, b] = PAL_RGB[p]
      expect(Math.abs(r - g) + Math.abs(g - b)).toBeLessThan(120)
    }
  })
})

describe('srgbToLab', () => {
  it('is monotone in lightness (black < grey < white)', () => {
    expect(srgbToLab(0, 0, 0)[0]).toBeLessThan(srgbToLab(128, 128, 128)[0])
    expect(srgbToLab(128, 128, 128)[0]).toBeLessThan(srgbToLab(255, 255, 255)[0])
  })
})

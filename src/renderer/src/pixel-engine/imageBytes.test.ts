import { describe, it, expect } from 'vitest'
import {
  bufferToC64,
  c64ToBuffer,
  IMG_W,
  IMG_H,
  IMG_BITMAP_BYTES,
  IMG_SCREEN_BYTES,
  IMG_COLOR_BYTES
} from './imageBytes'

const BG = 6 // a non-zero background, to catch bg/colour-0 confusion

describe('imageBytes: sizes', () => {
  it('produces the exact C64 plane sizes', () => {
    const { bitmap, screen, color } = bufferToC64(new Uint8Array(IMG_W * IMG_H).fill(BG), BG)
    expect(bitmap.length).toBe(IMG_BITMAP_BYTES)
    expect(screen.length).toBe(IMG_SCREEN_BYTES)
    expect(color.length).toBe(IMG_COLOR_BYTES)
  })
})

describe('imageBytes: pixel → C64 pattern', () => {
  it('packs the leftmost pixel of cell 0 as the top two bits of bitmap byte 0', () => {
    const buf = new Uint8Array(IMG_W * IMG_H).fill(BG)
    buf[0] = 3 // one non-bg colour → slot %01, at the leftmost of 4 MC pixels
    const { bitmap, screen } = bufferToC64(buf, BG)
    expect(bitmap[0]).toBe(0b01000000) // code %01 in the high bit-pair
    expect(screen[0] >> 4).toBe(3) // slot %01 colour stored in the hi nibble
  })

  it('maps background pixels to pattern %00', () => {
    const buf = new Uint8Array(IMG_W * IMG_H).fill(BG)
    const { bitmap } = bufferToC64(buf, BG)
    expect(bitmap.every((b) => b === 0)).toBe(true)
  })
})

/** Build a C64-legal canvas: each cell uses bg plus up to 3 chosen colours. */
function legalCanvas(): Uint8Array {
  const buf = new Uint8Array(IMG_W * IMG_H).fill(BG)
  for (let cy = 0; cy < IMG_H / 8; cy++) {
    for (let cx = 0; cx < IMG_W / 4; cx++) {
      // Three colours that vary per cell but never exceed the budget.
      const palette = [BG, (cx + 1) % 16, (cy + 2) % 16, (cx + cy + 3) % 16]
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 4; col++) {
          const x = cx * 4 + col
          const y = cy * 8 + row
          buf[y * IMG_W + x] = palette[(row + col) % 4]
        }
      }
    }
  }
  return buf
}

describe('imageBytes: round-trip', () => {
  it('canvas → C64 → canvas is identity for a C64-legal image', () => {
    const buf = legalCanvas()
    const { bitmap, screen, color } = bufferToC64(buf, BG)
    const back = c64ToBuffer(bitmap, screen, color, BG)
    expect(back).toEqual(buf)
  })

  it('drops a stray 4th colour to background instead of corrupting the cell', () => {
    const buf = new Uint8Array(IMG_W * IMG_H).fill(BG)
    // Cell 0 gets 4 non-bg colours, each twice so ordering is stable; the 4th is evicted.
    buf[0] = 1
    buf[1] = 1
    buf[2] = 2
    buf[3] = 2
    buf[IMG_W + 0] = 3
    buf[IMG_W + 1] = 3
    buf[IMG_W + 2] = 9 // the 4th colour (single-ish) → dropped to bg on pack
    const { bitmap, screen, color } = bufferToC64(buf, BG)
    const back = c64ToBuffer(bitmap, screen, color, BG)
    // The three kept colours survive; the evicted pixel reads back as background.
    expect(back[0]).toBe(1)
    expect(back[2]).toBe(2)
    expect(back[IMG_W + 0]).toBe(3)
    expect(back[IMG_W + 2]).toBe(BG)
  })
})

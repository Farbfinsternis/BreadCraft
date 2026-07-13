import { describe, it, expect } from 'vitest'
import { serializeImage, parseImage, IMAGE_W, IMAGE_H, type ImageData } from './assetIo'

const BG = 6

/** A C64-legal canvas (each cell ≤ bg + 3 colours), so packing is lossless. */
function legalCanvas(): Uint8Array {
  const buf = new Uint8Array(IMAGE_W * IMAGE_H).fill(BG)
  for (let cy = 0; cy < IMAGE_H / 8; cy++) {
    for (let cx = 0; cx < IMAGE_W / 4; cx++) {
      const cellColours = [BG, (cx + 1) % 16, (cy + 2) % 16, (cx + cy + 3) % 16]
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 4; col++) {
          buf[(cy * 8 + row) * IMAGE_W + (cx * 4 + col)] = cellColours[(row + col) % 4]
        }
      }
    }
  }
  return buf
}

describe('image asset IO (B2.T2)', () => {
  it('round-trips a C64-legal canvas + background', () => {
    const data: ImageData = { pixels: legalCanvas(), background: BG }
    const back = parseImage(serializeImage(data))!
    expect(back).not.toBeNull()
    expect(back.background).toBe(BG)
    expect(Array.from(back.pixels)).toEqual(Array.from(data.pixels))
  })

  it('writes the C64 format marker', () => {
    const json = serializeImage({ pixels: new Uint8Array(IMAGE_W * IMAGE_H).fill(BG), background: BG })
    expect(JSON.parse(json).format).toBe('breadcraft.image')
  })

  it('returns null on malformed or wrong-sized data (editor loads blank, no crash)', () => {
    expect(parseImage('{ nope')).toBeNull()
    expect(parseImage(JSON.stringify({ bitmap: [1, 2], screen: [], color: [] }))).toBeNull()
  })
})

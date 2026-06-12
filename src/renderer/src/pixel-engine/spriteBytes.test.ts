import { describe, it, expect } from 'vitest'
import {
  indicesToBytesSpriteHires,
  bytesToIndicesSpriteHires,
  indicesToBytesSpriteMC,
  bytesToIndicesSpriteMC,
  SPRITE_BYTES,
  SPRITE_HIRES_CELLS,
  SPRITE_MC_CELLS
} from './spriteBytes'

const HIRES_W = 24
const MC_W = 12

describe('sprite hi-res byte conversion (24×21 → 63 bytes)', () => {
  it('packs an empty grid to 63 zero bytes', () => {
    const bytes = indicesToBytesSpriteHires(new Uint8Array(SPRITE_HIRES_CELLS))
    expect(bytes.length).toBe(SPRITE_BYTES)
    expect(Array.from(bytes).every((b) => b === 0)).toBe(true)
  })

  it('packs the leftmost pixel of row 0 as bit 7 of byte 0 (0x80)', () => {
    const cells = new Uint8Array(SPRITE_HIRES_CELLS)
    cells[0] = 1 // (x=0, y=0)
    const bytes = indicesToBytesSpriteHires(cells)
    expect(bytes[0]).toBe(0x80)
    expect(bytes[1]).toBe(0)
    expect(bytes[2]).toBe(0)
  })

  it('packs the rightmost pixel of row 0 as bit 0 of byte 2 (0x01)', () => {
    const cells = new Uint8Array(SPRITE_HIRES_CELLS)
    cells[23] = 1 // (x=23, y=0) → last byte of row, lowest bit
    const bytes = indicesToBytesSpriteHires(cells)
    expect(bytes[0]).toBe(0)
    expect(bytes[2]).toBe(0x01)
  })

  it('packs a full top row as three 0xFF bytes', () => {
    const cells = new Uint8Array(SPRITE_HIRES_CELLS)
    for (let x = 0; x < HIRES_W; x++) cells[x] = 1
    const bytes = indicesToBytesSpriteHires(cells)
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xff, 0xff])
  })

  it('puts the bottom-left pixel into the last row (bytes 60–62)', () => {
    const cells = new Uint8Array(SPRITE_HIRES_CELLS)
    cells[20 * HIRES_W] = 1 // (x=0, y=20)
    const bytes = indicesToBytesSpriteHires(cells)
    expect(bytes[60]).toBe(0x80)
  })

  it('round-trips bytes → indices → bytes', () => {
    const bytes = new Uint8Array(SPRITE_BYTES)
    for (let i = 0; i < SPRITE_BYTES; i++) bytes[i] = (i * 37) & 0xff
    const back = indicesToBytesSpriteHires(bytesToIndicesSpriteHires(bytes))
    expect(Array.from(back)).toEqual(Array.from(bytes))
  })

  it('unpack yields a 504-cell grid of only 0/1', () => {
    const cells = bytesToIndicesSpriteHires(new Uint8Array(SPRITE_BYTES).fill(0xaa))
    expect(cells.length).toBe(SPRITE_HIRES_CELLS)
    expect(cells.every((v) => v === 0 || v === 1)).toBe(true)
  })
})

describe('sprite multicolor byte conversion (12×21 → 63 bytes)', () => {
  it('packs an empty 12×21 grid to 63 zero bytes', () => {
    const bytes = indicesToBytesSpriteMC(new Uint8Array(SPRITE_MC_CELLS))
    expect(bytes.length).toBe(SPRITE_BYTES)
    expect(Array.from(bytes).every((b) => b === 0)).toBe(true)
  })

  it('packs the leftmost double-pixel into bits 7–6 of byte 0', () => {
    const cells = new Uint8Array(SPRITE_MC_CELLS)
    cells[0] = 3 // dp=0, row 0
    expect(indicesToBytesSpriteMC(cells)[0]).toBe(0b11000000)
  })

  it('packs the rightmost double-pixel into bits 1–0 of byte 2', () => {
    const cells = new Uint8Array(SPRITE_MC_CELLS)
    cells[11] = 3 // dp=11 (last of row 0)
    const bytes = indicesToBytesSpriteMC(cells)
    expect(bytes[0]).toBe(0)
    expect(bytes[2]).toBe(0b00000011)
  })

  it('places four double-pixels per byte, left→right', () => {
    const cells = new Uint8Array(SPRITE_MC_CELLS)
    cells[0] = 0
    cells[1] = 1
    cells[2] = 2
    cells[3] = 3
    expect(indicesToBytesSpriteMC(cells)[0]).toBe(0b00_01_10_11)
  })

  it('round-trips indices → bytes → indices losslessly for all of 0–3', () => {
    const cells = new Uint8Array(SPRITE_MC_CELLS)
    for (let i = 0; i < SPRITE_MC_CELLS; i++) cells[i] = (i % 4) as 0 | 1 | 2 | 3
    const back = bytesToIndicesSpriteMC(indicesToBytesSpriteMC(cells))
    expect(Array.from(back)).toEqual(Array.from(cells))
  })

  it('preserves indices 2 and 3 (the lossless MC contract)', () => {
    const cells = new Uint8Array(SPRITE_MC_CELLS)
    cells[0] = 2
    cells[1] = 3
    const back = bytesToIndicesSpriteMC(indicesToBytesSpriteMC(cells))
    expect(back[0]).toBe(2)
    expect(back[1]).toBe(3)
  })

  it('unpack yields a 252-cell grid', () => {
    const cells = bytesToIndicesSpriteMC(new Uint8Array(SPRITE_BYTES))
    expect(cells.length).toBe(SPRITE_MC_CELLS)
  })
})

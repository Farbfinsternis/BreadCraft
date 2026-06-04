import { describe, it, expect } from 'vitest'
import {
  indicesToBytesHires,
  bytesToIndicesHires,
  indicesToBytesMC,
  bytesToIndicesMC
} from './charsetBytes'

describe('charset hi-res byte conversion', () => {
  it('packs an empty grid to 8 zero bytes', () => {
    const bytes = indicesToBytesHires(new Uint8Array(64))
    expect(Array.from(bytes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('packs the leftmost pixel of row 0 as bit 7 (0x80)', () => {
    const cells = new Uint8Array(64)
    cells[0] = 1 // (x=0, y=0)
    const bytes = indicesToBytesHires(cells)
    expect(bytes[0]).toBe(0x80)
  })

  it('packs the rightmost pixel of row 0 as bit 0 (0x01)', () => {
    const cells = new Uint8Array(64)
    cells[7] = 1 // (x=7, y=0)
    expect(indicesToBytesHires(cells)[0]).toBe(0x01)
  })

  it('packs a full top row as 0xFF', () => {
    const cells = new Uint8Array(64)
    for (let x = 0; x < 8; x++) cells[x] = 1
    expect(indicesToBytesHires(cells)[0]).toBe(0xff)
  })

  it('treats any non-zero index as set (hi-res is 1-bit)', () => {
    const cells = new Uint8Array(64)
    cells[0] = 3 // an MC index still reads as "set" in hi-res
    cells[1] = 2
    expect(indicesToBytesHires(cells)[0]).toBe(0xc0) // bits 7 and 6
  })

  it('round-trips bytes → indices → bytes', () => {
    const bytes = new Uint8Array([0b10000001, 0x00, 0xff, 0x18, 0x24, 0x42, 0x81, 0x7e])
    const cells = bytesToIndicesHires(bytes)
    const back = indicesToBytesHires(cells)
    expect(Array.from(back)).toEqual(Array.from(bytes))
  })

  it('unpack yields only 0/1 indices', () => {
    const cells = bytesToIndicesHires(new Uint8Array([0xff, 0xaa, 0x55, 0, 0, 0, 0, 0]))
    expect(cells.every((v) => v === 0 || v === 1)).toBe(true)
    // row 1 (0xAA = 10101010) → leftmost set, alternating
    expect(cells[8]).toBe(1)
    expect(cells[9]).toBe(0)
  })
})

describe('charset multicolor byte conversion (PETSCII_FORMAT.md §1.1)', () => {
  it('packs an empty 4×8 grid to 8 zero bytes', () => {
    const bytes = indicesToBytesMC(new Uint8Array(32))
    expect(Array.from(bytes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('packs the leftmost double-pixel into the most-significant pair (bits 7–6)', () => {
    const cells = new Uint8Array(32)
    cells[0] = 3 // dp=0, row 0 → 11 in bits 7–6
    expect(indicesToBytesMC(cells)[0]).toBe(0b11000000) // 0xC0
  })

  it('packs the rightmost double-pixel into the least-significant pair (bits 1–0)', () => {
    const cells = new Uint8Array(32)
    cells[3] = 3 // dp=3, row 0 → 11 in bits 1–0
    expect(indicesToBytesMC(cells)[0]).toBe(0b00000011) // 0x03
  })

  it('places each double-pixel index in its own 2-bit slot, left→right', () => {
    const cells = new Uint8Array(32)
    cells[0] = 0 // dp0 → 00
    cells[1] = 1 // dp1 → 01
    cells[2] = 2 // dp2 → 10
    cells[3] = 3 // dp3 → 11
    expect(indicesToBytesMC(cells)[0]).toBe(0b00_01_10_11) // 0x1B
  })

  it('round-trips indices → bytes → indices losslessly for all of 0–3', () => {
    const cells = new Uint8Array(32)
    for (let i = 0; i < 32; i++) cells[i] = (i % 4) as 0 | 1 | 2 | 3
    const back = bytesToIndicesMC(indicesToBytesMC(cells))
    expect(Array.from(back)).toEqual(Array.from(cells))
  })

  it('round-trips bytes → indices → bytes', () => {
    const bytes = new Uint8Array([0x1b, 0xff, 0x00, 0xe4, 0x39, 0xaa, 0x55, 0xc3])
    const back = indicesToBytesMC(bytesToIndicesMC(bytes))
    expect(Array.from(back)).toEqual(Array.from(bytes))
  })

  it('preserves indices 2 and 3 — the bug the hi-res converter caused', () => {
    const cells = new Uint8Array(32)
    cells[0] = 2
    cells[1] = 3
    const back = bytesToIndicesMC(indicesToBytesMC(cells))
    expect(back[0]).toBe(2)
    expect(back[1]).toBe(3)
  })
})

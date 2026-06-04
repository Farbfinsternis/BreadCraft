import { describe, it, expect } from 'vitest'
import rawSsot from './breadcraft.lang.json'
import type { Ssot } from './ssot-types'
import { graphicsCommandFor } from './graphics-mode'
import type { GraphicsMode } from './ipc'

const SSOT = rawSsot as unknown as Ssot

describe('graphicsCommandFor (mode ↔ Graphics command, SSOT-derived)', () => {
  it('maps TEXT_MULTICOLOR to the SSOT-spelled command', () => {
    expect(graphicsCommandFor(SSOT, 'TEXT_MULTICOLOR')).toBe('Graphics TEXT, MULTICOLOR')
  })

  it('maps the other two Phase-1 modes', () => {
    expect(graphicsCommandFor(SSOT, 'TEXT_HIRES')).toBe('Graphics TEXT, HIRES')
    expect(graphicsCommandFor(SSOT, 'BITMAP_MULTICOLOR')).toBe('Graphics BITMAP, MULTICOLOR')
  })

  it('uses the SSOT enum names verbatim (the keywords come from the SSOT, not the helper)', () => {
    const area = SSOT.enums.find((e) => e.id === 'GfxArea')!.values.find((v) => v.value === 'TEXT')!
    const color = SSOT.enums
      .find((e) => e.id === 'GfxColor')!
      .values.find((v) => v.value === 'MULTICOLOR')!
    expect(graphicsCommandFor(SSOT, 'TEXT_MULTICOLOR')).toBe(`Graphics ${area.name}, ${color.name}`)
  })

  it('throws on a mode whose axis the SSOT does not define', () => {
    expect(() => graphicsCommandFor(SSOT, 'TEXT_NEON' as GraphicsMode)).toThrow(/GfxColor/)
  })

  it('throws on a malformed mode (no AREA_COLOR split)', () => {
    expect(() => graphicsCommandFor(SSOT, 'TEXT' as GraphicsMode)).toThrow(/AREA_COLOR/)
  })
})

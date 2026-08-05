import { describe, it, expect } from 'vitest'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '@shared/vocabulary'
import type { Ssot, VocabItem } from '@shared/ssot-types'
import { compile } from '@transpiler/index'
import type { AssetContext } from '@transpiler/codegen'
import { resolveImage } from '@transpiler/assets/asset-resolver'
import { sampleMain, starterImage } from './project'

// THE GUIDED STARTER (BRONZE B2.T6 follow-up). The `image` template's whole point is that
// the FIRST build already shows a picture — no unknown-asset error, no bitmap garbage, no
// "did it work?". That promise only holds if the generated source and the generated asset
// agree with each other, so this compiles the one against the other for real.

const vocab: VocabItem[] = buildVocabulary(rawSsot as unknown as Ssot)

/** The project the `image` template writes to disk, as the transpiler would see it. */
function starterAssets(): AssetContext {
  const image = starterImage()
  return {
    manifest: { palette: null, charsets: [], tilemaps: [], sprites: [], images: ['main.image'] },
    readFile: (rel: string) => (rel === 'main.image' ? image : null)
  }
}

describe('the image starter: source and asset fit each other', () => {
  it('compiles with no errors — the first build shows the picture', () => {
    const { code, errors } = compile(sampleMain('image'), vocab, starterAssets())
    expect(errors.filter((e) => e.severity === 'error')).toEqual([])
    // UseImage baked it (the linker places it) and DrawImage puts it on screen.
    expect(code).toContain('const unsigned char img_main[8000]')
    expect(code).toContain('VIC.addr = 0x78;')
    expect(code).toContain('BC_COLOR_RAM[_i] = imgcol_main[_i];')
  })

  it('warns about nothing — a starter that nags is not a starter', () => {
    const { errors } = compile(sampleMain('image'), vocab, starterAssets())
    // In particular NOT the "bakes no image" warning: the template brings one.
    expect(errors).toEqual([])
  })

  it('the plain starter stays in text mode and reserves no bitmap', () => {
    const { code, errors } = compile(sampleMain('plain'), vocab)
    expect(errors).toEqual([])
    expect(code).not.toContain('BC_BITMAP')
  })

  it('the starter image is a legal .image the resolver accepts', () => {
    const img = resolveImage('main', starterAssets().manifest, starterAssets().readFile)
    expect(img.bitmap.length).toBe(8000)
    expect(img.screen.length).toBe(1000)
    expect(img.color.length).toBe(1000)
    expect(img.background).toBe(6) // blue — the C64's own screen colour
  })

  // NOT a blank canvas on purpose: one flat colour is exactly what a BROKEN build looks
  // like, which is the confusion this starter exists to remove. A frame is unmistakably
  // a picture — and one fill click away from gone.
  it('has something visible on it: a white frame around a blue field', () => {
    const img = resolveImage('main', starterAssets().manifest, starterAssets().readFile)
    const cellAt = (col: number, row: number): number => row * 40 + col
    // Corner + top edge cells: eight rows of %01 pixels, white in the screen hi nibble.
    for (const cell of [cellAt(0, 0), cellAt(39, 0), cellAt(0, 24), cellAt(39, 24), cellAt(20, 0)]) {
      expect(Array.from(img.bitmap.subarray(cell * 8, cell * 8 + 8))).toEqual(Array(8).fill(0x55))
      expect(img.screen[cell] >> 4).toBe(1)
    }
    // …and the middle is untouched background (%00), not a solid block.
    const inner = cellAt(20, 12)
    expect(Array.from(img.bitmap.subarray(inner * 8, inner * 8 + 8))).toEqual(Array(8).fill(0))
  })
})

// STAHL S9 — the one semantic the Font-Linse needs: which PETSCII character a given
// charset slot stands for. It's ONE charset (font and tiles share the same 256
// slots), so there's nothing to tag or count — the lens just shows, on a "named"
// slot, the letter that natively lives there (the ghost), and leaves the anonymous
// slots free for tiles. This maps slot → its canonical character; the ghost's actual
// pixels come from the ROM font (c64-rom-font.ts). Pure, editor-only, 0 runtime cost.

import { C64_ROM_FONT_UPPER, ROM_GLYPH_BYTES } from './c64-rom-font'

/** Size of the reserved Hires FONT region (slots 0..FONT_SLOTS-1). The single source
 *  of truth for the Mixed-Mode split (MIXED_MODE_FONT_PLAN): these low slots hold the
 *  Hires font glyphs DrawText draws, the rest (FONT_SLOTS..255) is MC tile territory.
 *  64 = the canonical screen-code block (@, A–Z, punctuation, space, digits) that
 *  `bc_drawtext` and `charForSlot` already address. */
export const FONT_SLOTS = 64

/**
 * Fill EMPTY font slots (0..FONT_SLOTS-1, i.e. all-zero glyphs) of a resolved charset
 * with the C64 ROM font, so DrawText shows readable letters even before the user pixels
 * their own font (MIXED_MODE_FONT_PLAN F2). Painted glyphs are kept untouched (the
 * future Hires Font-Editor writes here). Returns a NEW array; the input is not mutated.
 * Only call this when the program actually draws text — otherwise an unrelated tile that
 * happens to sit on an empty low slot would suddenly show a letter.
 */
export function seedFontRegion(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes)
  for (let slot = 0; slot < FONT_SLOTS; slot++) {
    const o = slot * ROM_GLYPH_BYTES
    if (o + ROM_GLYPH_BYTES > out.length) break
    let empty = true
    for (let i = 0; i < ROM_GLYPH_BYTES; i++) {
      if (out[o + i] !== 0) {
        empty = false
        break
      }
    }
    if (empty) {
      for (let i = 0; i < ROM_GLYPH_BYTES; i++) out[o + i] = C64_ROM_FONT_UPPER[o + i] ?? 0
    }
  }
  return out
}

/**
 * The canonical character a charset slot stands for in the UPPERCASE/GRAPHICS bank
 * (the bank DrawText/`cputsxy` runs in), or null when the slot holds no plain-ASCII
 * font glyph (the graphics/reversed region, or a non-ASCII C64 symbol). The Font-
 * Linse uses `charForSlot(slot) === null` to decide which slots are "named" (get a
 * letter ghost) versus anonymous tile territory.
 */
export function charForSlot(slot: number): string | null {
  if (slot === 0) return '@'
  if (slot >= 1 && slot <= 26) return String.fromCharCode(0x40 + slot) // A–Z
  if (slot === 27) return '['
  if (slot === 29) return ']'
  // space(32)…'?'(63): the screen code IS the ASCII code in this block (space, the
  // digits 0–9, and the punctuation a HUD realistically uses).
  if (slot >= 0x20 && slot <= 0x3f) return String.fromCharCode(slot)
  // Slot 28 (£), 30 (↑), 31 (←) and everything ≥ 64: no plain-ASCII font glyph.
  return null
}

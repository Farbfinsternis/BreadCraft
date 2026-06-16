// STAHL S9 — the one semantic the Font-Linse needs: which PETSCII character a given
// charset slot stands for. It's ONE charset (font and tiles share the same 256
// slots), so there's nothing to tag or count — the lens just shows, on a "named"
// slot, the letter that natively lives there (the ghost), and leaves the anonymous
// slots free for tiles. This maps slot → its canonical character; the ghost's actual
// pixels come from the ROM font (c64-rom-font.ts). Pure, editor-only, 0 runtime cost.

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

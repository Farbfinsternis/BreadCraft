/**
 * Ordered (Bayer) dithering — the C64's answer to a 16-colour palette (BRONZE B2.T2b).
 *
 * With only 16 fixed colours and no true blending, a smooth transition is FAKED: two
 * affordable colours laid in a fine checkerboard read as a third shade, and a threshold
 * that shifts across space reads as a gradient. A 4×4 Bayer matrix gives a stable,
 * non-directional pattern (no worm artefacts). Pure + headless, so it is Vitest-provable
 * exactly like the other pixel-engine maths — no Vue, no canvas.
 */

/** 4×4 Bayer matrix (values 0–15), the classic ordered-dither pattern. */
export const BAYER4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

/**
 * The dither threshold in (0,1) for pixel (x,y). Compare a 0..1 mix fraction against it:
 * `fraction > threshold(x,y)` → the "to" colour, else the "from" colour. So fraction 0
 * is pure `from`, fraction 1 pure `to`, and 0.5 an even checkerboard. Tiles every 4 px,
 * so a large area dithers as one consistent fabric. Negative coords wrap cleanly.
 */
export function ditherThreshold(x: number, y: number): number {
  const m = BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4]
  return (m + 0.5) / 16
}

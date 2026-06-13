/**
 * Localized text for the structural asset-format errors (STAHL S5b, part 3). These
 * AssetFormatError predicates are only ever SURFACED by the build resolver (the
 * editor catches them and loads tolerantly), so the resolver passes its locale here;
 * the renderer's calls keep the German default (the message is unused there). German
 * is byte-identical to the former inline literals so the format tests stay green.
 *
 * Self-contained in the shared layer: the format module owns the WORDING of its own
 * errors, so it owns their translations too (no import of the transpiler catalog).
 */
import type { Locale } from '@shared/ipc'

export type { Locale }
export const DEFAULT_FORMAT_LOCALE: Locale = 'de'

/** Predicate phrases a caller prefixes with the asset label + path, e.g.
 *  `Tileset 'main.petscii' ` + `ist kein gültiges .petscii (JSON kaputt)`. */
export interface FormatMessages {
  /** Broken JSON. `ext` is the file extension incl. dot (`.petscii`). */
  jsonBroken(ext: string): string
  /** A required top-level array field is missing. `field` is its name (`chars`). */
  noField(field: string): string
  /** A charset has the wrong number of char rows. */
  wrongCharCount(n: number, expected: number): string
  /** A tilemap has no `grafik` layer carrying tiles. */
  noGrafikLayer(): string
}

const DE: FormatMessages = {
  jsonBroken: (ext) => `ist kein gültiges ${ext} (JSON kaputt)`,
  noField: (field) => `hat keine '${field}'-Daten`,
  wrongCharCount: (n, expected) => `hat ${n} Zeichen, erwartet ${expected}`,
  noGrafikLayer: () => `hat keinen Grafik-Layer mit Kacheln`
}

const EN: FormatMessages = {
  jsonBroken: (ext) => `is not a valid ${ext} (broken JSON)`,
  noField: (field) => `has no '${field}' data`,
  wrongCharCount: (n, expected) => `has ${n} chars, expected ${expected}`,
  noGrafikLayer: () => `has no graphics layer with tiles`
}

/** The format-error wording for a locale (German is the default; English additive). */
export function formatMessages(locale: Locale = DEFAULT_FORMAT_LOCALE): FormatMessages {
  return locale === 'en' ? EN : DE
}

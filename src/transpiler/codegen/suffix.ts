/**
 * WHAT A TYPE SUFFIX MEANS — the one place that knows a scalar suffix from a record one.
 *
 * It lives on its own because two callers need it and neither may own it: the codegen (which
 * translates every declaration) and the inlining decision (which must refuse a function that
 * takes or returns a record, because those travel as pointers). Two copies of this rule would
 * be two truths, and the second one is always the one that goes stale.
 */

/** The scalar suffixes: width first, then sign (`.b` byte, `.s` signed byte, `.w` word,
 *  `.i` signed word) — plus `$` for a string. */
export const SCALAR_SUFFIXES = new Set(['$', '.b', '.s', '.w', '.i'])

/**
 * The record type name in a suffix like `.Slot`, or undefined for a scalar suffix
 * (`.b`/`.s`/`.w`/`.i`/`$`) or none. The lexer only attaches `.Name` when Name is a known
 * record, so any `.x` that isn't a scalar suffix is a record type.
 */
export function recordSuffixName(suffix: string | undefined): string | undefined {
  if (!suffix || SCALAR_SUFFIXES.has(suffix)) return undefined
  if (suffix.startsWith('.')) return suffix.slice(1)
  return undefined
}

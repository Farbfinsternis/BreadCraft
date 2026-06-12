import type { VocabItem } from '@renderer/language/ssot'

// Pure auto-casing policy — no Monaco, so it is unit-testable. EISEN M2.T2b / N4.
//
// Under case-sensitivity the editor must NEVER turn a variable into a CRUMB word:
// `vwait`, `next` are legal names of the user's own. So auto-casing casts a narrow
// net — it canonicalizes only where a CRUMB word is unambiguous, and "im Zweifel
// NICHT umschreiben". The renderer has no live scope, so every signal is read from
// the line itself.

/**
 * Decide whether a just-typed word may be rewritten to its canonical CRUMB spelling,
 * given the line text, the word's 0-based bounds, and the grammar kind of the match.
 *
 *   - a word that is (or will be) an assignment/index/field target → never (`vwait =`, `feld[`, `p\`)
 *   - the name right after a declaration keyword / inside a Function(…) param list → never
 *   - a bare word at statement start completed by whitespace is ambiguous (a command
 *     OR a fresh variable's assignment) → never (commands arrive via completion); a
 *     '(' there means a call, so the callee is safe
 *   - elsewhere (argument/value position) only a constant (`Cls BLACK`) or a *called*
 *     function (`Str$(x)`) is safe; a keyword/command/bare-function fold is a variable
 */
export function shouldCanonicalize(
  line: string,
  wordStart: number,
  wordEnd: number,
  kind: VocabItem['kind']
): boolean {
  const before = line.slice(0, wordStart)
  const after = line.slice(wordEnd)
  const nextNonSpace = after.replace(/^[ \t]*/, '')[0] ?? ''

  // assignment / index / field target → a name being written, never a CRUMB word.
  if (nextNonSpace === '=' || nextNonSpace === '[' || nextNonSpace === '\\') return false

  // the name being declared: right after Dim/Global/Const/For/Field/Function …
  if (/\b(Dim|Global|Const|For|Field|Function)\s+\S*$/.test(before)) return false
  // … or inside a Function definition's parameter list.
  if (/^\s*Function\b/.test(line) && /\([^)]*$/.test(before)) return false

  // statement start: ambiguous between a command and a new variable's assignment →
  // leave it (a '(' means a call, so the callee is safe to canonicalize).
  if (/^\s*$/.test(before)) return nextNonSpace === '('

  // value / argument position.
  if (kind === 'constant') return true
  if (kind === 'function' && nextNonSpace === '(') return true
  return false
}

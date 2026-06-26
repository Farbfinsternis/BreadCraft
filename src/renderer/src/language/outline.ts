// Lightweight symbol scanner for .crumb source. This is a HEURISTIC (line-based
// regex), NOT a real parse — it exists so the Outliner reflects actual code
// today. When the transpiler's lexer/parser/AST lands, replace this with the
// real symbol table (SPRACHE.md §7.4). Comments start with ';' and are ignored.
//
// Scope: the Outliner lists ONLY user-defined routines — every one is declared
// with `Function … EndFunction` (there is NO `Sub`). Whether it's a "Function"
// (returns a value, called with parens) or a "Statement" (no return value,
// callable without parens) is decided by the RETURN-TYPE SUFFIX on the name:
//   Function Distance.w(...)  → function  (suffix .w)
//   Function Name$(...)       → function  (suffix $)
//   Function Heal(...)        → statement (no suffix)
// See memory: breadcraft-functions-vs-statements / SPRACHDEFINITION.md §C.1.

export type OutlineKind = 'function' | 'statement' | 'section'

export interface OutlineSymbol {
  /** Bare name without the return-type suffix; for a section, the marker title. */
  name: string
  kind: OutlineKind
  /** 1-based line number in the source. */
  line: number
}

// Capture the declared name including an optional return-type suffix (.b/.w/.i/$).
// Case-SENSITIVE (EISEN M2.T2): only the canonical `Function` keyword starts a def.
const FUNCTION_RE = /^\s*Function\s+([A-Za-z_]\w*)(\.[bwi]|\$)?/

// A user-placed Outliner waypoint: a comment whose first non-space char is '#'.
//   ; # Konstanten   →  section "Konstanten"
// It stays an ordinary ';' comment (cc65/transpiler ignore it); the '#' is just a
// signal to the Outliner. Extra '#'s and surrounding space are tolerated.
const SECTION_RE = /^\s*;\s*#+\s*(\S.*?)\s*$/

function stripComment(line: string): string {
  // Drop a trailing ';' comment (Sprachdef §B), but not one inside a string literal.
  let inStr = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inStr = !inStr
    else if (c === ';' && !inStr) return line.slice(0, i)
  }
  return line
}

export function scanOutline(source: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = []
  const lines = source.split(/\r?\n/)

  lines.forEach((raw, idx) => {
    // A '; #' waypoint is a comment, so test it on the raw line (stripComment would
    // erase it). Functions are read from the comment-stripped line.
    const sec = SECTION_RE.exec(raw)
    if (sec) {
      symbols.push({ name: sec[1], kind: 'section', line: idx + 1 })
      return
    }
    const m = FUNCTION_RE.exec(stripComment(raw))
    if (!m) return
    const suffix = m[2] // '.b' | '.w' | '$' | undefined
    symbols.push({
      name: m[1],
      kind: suffix ? 'function' : 'statement',
      line: idx + 1
    })
  })

  return symbols
}

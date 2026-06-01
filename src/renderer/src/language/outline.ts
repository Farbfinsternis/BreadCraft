// Lightweight symbol scanner for .crumb source. This is a HEURISTIC (line-based
// regex), NOT a real parse — it exists so the Outliner reflects actual code
// today. When the transpiler's lexer/parser/AST lands, replace this with the
// real symbol table (SPRACHE.md §7.4). Comments start with ' and are ignored.
//
// Scope: the Outliner lists ONLY user-defined routines — every one is declared
// with `Function … EndFunction` (there is NO `Sub`). Whether it's a "Function"
// (returns a value, called with parens) or a "Statement" (no return value,
// callable without parens) is decided by the RETURN-TYPE SUFFIX on the name:
//   Function Distance.w(...)  → function  (suffix .w)
//   Function Name$(...)       → function  (suffix $)
//   Function Heal(...)        → statement (no suffix)
// See memory: breadcraft-functions-vs-statements / SPRACHDEFINITION.md §C.1.

export type OutlineKind = 'function' | 'statement'

export interface OutlineSymbol {
  /** Bare name without the return-type suffix. */
  name: string
  kind: OutlineKind
  /** 1-based line number in the source. */
  line: number
}

// Capture the declared name including an optional return-type suffix (.b/.w/$).
const FUNCTION_RE = /^\s*Function\s+([A-Za-z_]\w*)(\.[bw]|\$)?/i

function stripComment(line: string): string {
  // Drop a trailing ' comment, but not one inside a string literal.
  let inStr = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inStr = !inStr
    else if (c === "'" && !inStr) return line.slice(0, i)
  }
  return line
}

export function scanOutline(source: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = []
  const lines = source.split(/\r?\n/)

  lines.forEach((raw, idx) => {
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

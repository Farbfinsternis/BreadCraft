import type { VocabItem } from '@shared/ssot-types'
import type { Token } from './token'
import { TokenType } from './token'

// The .crumb lexer: source text → classified token stream. Pure and synchronous;
// no I/O, no throwing. Unknown/broken input becomes an Error token so the parser
// can report a precise location later. SSOT-fed: identifier classification comes
// entirely from the injected vocabulary (memory: breadcraft-tokenizer-ssot).

const COMMENT_START = ';' // line comment to end of line (Sprachdef §B)
const DQUOTE = '"'

/** Operator characters (multi-char operators are greedily grouped, like Monaco). */
const OP_CHARS = new Set('=+-*/<>&|'.split(''))

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}
function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
}
function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

/**
 * Map a vocabulary item's kind to its token type. Mirrors the disambiguation the
 * Monaco tokenizer documents (crumb.ts): a few names exist in the SSOT both as a
 * constant and as a command/function (TEXT, LEFT, RIGHT). The lexer has no
 * grammar context, so — for consistent classification with the editor — constant
 * wins. The parser can refine by context later.
 */
function kindToTokenType(kind: VocabItem['kind']): TokenType {
  switch (kind) {
    case 'keyword':
      return TokenType.Keyword
    case 'command':
      return TokenType.Command
    case 'function':
      return TokenType.Function
    case 'constant':
      return TokenType.Constant
    case 'type':
      return TokenType.Type
    case 'operator':
      return TokenType.Operator
    default:
      return TokenType.Identifier
  }
}

/** Build the lowercased-key → TokenType lookup, constant-wins on collisions. */
function buildClassifier(vocabulary: VocabItem[]): Map<string, TokenType> {
  const map = new Map<string, TokenType>()
  const priority = (t: TokenType): number => (t === TokenType.Constant ? 2 : 1)
  for (const item of vocabulary) {
    const tt = kindToTokenType(item.kind)
    for (const key of item.lookupKeys) {
      const existing = map.get(key)
      if (existing === undefined || priority(tt) > priority(existing)) {
        map.set(key, tt)
      }
    }
  }
  return map
}

class Scanner {
  private readonly src: string
  private readonly classifier: Map<string, TokenType>
  /** User record type names (from `Type X`), so `.X` lexes as a type suffix. */
  private readonly recordNames: Set<string>
  private pos = 0
  private line = 1
  private col = 1
  private readonly tokens: Token[] = []

  constructor(src: string, classifier: Map<string, TokenType>, recordNames: Set<string>) {
    this.src = src
    this.classifier = classifier
    this.recordNames = recordNames
  }

  private peek(ahead = 0): string {
    return this.src[this.pos + ahead] ?? ''
  }

  /** Consume one char, advancing line/col. Newlines are handled by the caller. */
  private advance(): string {
    const ch = this.src[this.pos++]
    this.col++
    return ch
  }

  private push(
    type: TokenType,
    value: string,
    line: number,
    col: number,
    length: number,
    error?: string
  ): void {
    this.tokens.push({ type, value, line, col, length, ...(error ? { error } : {}) })
  }

  scan(): Token[] {
    while (this.pos < this.src.length) {
      const ch = this.peek()

      // Newline (significant: statement separator). Handle \r\n and \n.
      if (ch === '\n' || ch === '\r') {
        const line = this.line
        const col = this.col
        if (ch === '\r' && this.peek(1) === '\n') {
          this.pos += 2
        } else {
          this.pos += 1
        }
        this.push(TokenType.Newline, '\n', line, col, 1)
        this.line++
        this.col = 1
        continue
      }

      // Skip other whitespace (space, tab).
      if (ch === ' ' || ch === '\t') {
        this.advance()
        continue
      }

      // Line comment: ; ... until end of line (Sprachdef §B).
      if (ch === COMMENT_START) {
        this.scanComment()
        continue
      }

      // String literal.
      if (ch === DQUOTE) {
        this.scanString()
        continue
      }

      // $ — ambiguous: hex number ($FF) vs. string-type suffix on a name (name$).
      // A type suffix only attaches directly to a preceding identifier with no
      // gap; we detect that case when scanning identifiers. A bare $ followed by
      // hex digits is a hex number; a bare $ otherwise is an Error.
      if (ch === '$') {
        this.scanDollar()
        continue
      }

      // % binary number.
      if (ch === '%') {
        this.scanBinary()
        continue
      }

      // Decimal number.
      if (isDigit(ch)) {
        this.scanDecimal()
        continue
      }

      // Identifier / SSOT-classified word (may carry a .b/.w/$ suffix).
      if (isIdentStart(ch)) {
        this.scanIdentifier()
        continue
      }

      // Punctuation.
      if (ch === '(') {
        this.scanSingle(TokenType.LParen)
        continue
      }
      if (ch === ')') {
        this.scanSingle(TokenType.RParen)
        continue
      }
      if (ch === '[') {
        this.scanSingle(TokenType.LBracket)
        continue
      }
      if (ch === ']') {
        this.scanSingle(TokenType.RBracket)
        continue
      }
      if (ch === ',') {
        this.scanSingle(TokenType.Comma)
        continue
      }
      // '\' — record field access: tasche[3]\count (Sprachdef §C). Deliberately a
      // backslash (not the type-dot) so it never clashes with .b/.w suffixes.
      if (ch === '\\') {
        this.scanSingle(TokenType.Backslash)
        continue
      }
      // ':' separates multiple statements on one line (BASIC tradition), e.g.
      // `If x > 10 : DrawText 2,2,"Hi" : EndIf`. Treated like Newline by the
      // parser as a statement boundary — so the keyword/command that follows is
      // at a statement start even mid-line.
      if (ch === ':') {
        this.scanSingle(TokenType.StatementSep)
        continue
      }

      // Operators (greedy run of operator chars, like the Monaco tokenizer).
      if (OP_CHARS.has(ch)) {
        this.scanOperator()
        continue
      }

      // Unknown character → Error token, then move on (never throw).
      {
        const line = this.line
        const col = this.col
        const bad = this.advance()
        this.push(TokenType.Error, bad, line, col, 1, `Unerwartetes Zeichen '${bad}'`)
      }
    }

    this.push(TokenType.EOF, '', this.line, this.col, 0)
    return this.tokens
  }

  private scanSingle(type: TokenType): void {
    const line = this.line
    const col = this.col
    const ch = this.advance()
    this.push(type, ch, line, col, 1)
  }

  private scanComment(): void {
    const line = this.line
    const col = this.col
    this.advance() // leading ;
    let value = ''
    while (this.pos < this.src.length && this.peek() !== '\n' && this.peek() !== '\r') {
      value += this.advance()
    }
    // value is the payload (text after ;); length includes the ; marker, so the
    // editor can still highlight the whole comment range. Same rule as strings:
    // value = payload without the delimiter(s).
    this.push(TokenType.Comment, value, line, col, value.length + 1)
  }

  private scanString(): void {
    const line = this.line
    const col = this.col
    this.advance() // opening quote
    let value = ''
    while (this.pos < this.src.length) {
      const ch = this.peek()
      if (ch === DQUOTE) {
        this.advance() // closing quote
        // length includes both quotes
        this.push(TokenType.String, value, line, col, value.length + 2)
        return
      }
      if (ch === '\n' || ch === '\r') break // unterminated: strings are single-line
      value += this.advance()
    }
    // Reached EOL/EOF without a closing quote.
    this.push(
      TokenType.Error,
      value,
      line,
      col,
      value.length + 1,
      'Nicht geschlossener Text (fehlendes \")'
    )
  }

  private scanDollar(): void {
    const line = this.line
    const col = this.col
    this.advance() // '$'
    if (isHexDigit(this.peek())) {
      let digits = ''
      while (isHexDigit(this.peek())) digits += this.advance()
      this.push(TokenType.NumberHex, digits, line, col, digits.length + 1)
      return
    }
    // A lone '$' not forming a hex literal and not attached to a name.
    this.push(TokenType.Error, '$', line, col, 1, "Ungültiges '$' (Hex-Zahl oder Typ-Suffix erwartet)")
  }

  private scanBinary(): void {
    const line = this.line
    const col = this.col
    this.advance() // '%'
    if (this.peek() === '0' || this.peek() === '1') {
      let digits = ''
      while (this.peek() === '0' || this.peek() === '1') digits += this.advance()
      this.push(TokenType.NumberBin, digits, line, col, digits.length + 1)
      return
    }
    this.push(TokenType.Error, '%', line, col, 1, "Ungültige Binärzahl nach '%'")
  }

  private scanDecimal(): void {
    const line = this.line
    const col = this.col
    let digits = ''
    while (isDigit(this.peek())) digits += this.advance()
    this.push(TokenType.NumberDec, digits, line, col, digits.length)
  }

  private scanIdentifier(): void {
    const line = this.line
    const col = this.col
    let name = ''
    while (isIdentPart(this.peek())) name += this.advance()

    // A '$' / '.b' / '.w' may be PART OF A CANONICAL NAME (e.g. the string
    // functions Left$, Right$, Mid$, Chr$) or a TYPE SUFFIX on a variable
    // (score.b, name$). The SSOT decides: if name+suffix is a known vocabulary
    // word, it is ONE token classified by the vocab; otherwise the suffix is a
    // separate TypeSuffix token on the bare identifier. This is what keeps
    // `Left$` (a Function) distinct from `Left` (which would collide with the
    // JoyDir constant LEFT). (memory: breadcraft-functions-vs-statements)
    const suffix = this.peekTypeSuffix()
    if (suffix) {
      const combinedKind = this.classifier.get((name + suffix).toLowerCase())
      if (combinedKind !== undefined) {
        for (let i = 0; i < suffix.length; i++) this.advance()
        this.push(combinedKind, name + suffix, line, col, name.length + suffix.length)
        return
      }
    }

    // Plain identifier / SSOT-classified word (no suffix consumed into the name).
    const tt = this.classifier.get(name.toLowerCase()) ?? TokenType.Identifier
    this.push(tt, name, line, col, name.length)

    // Trailing suffix that did NOT form a known name → it types the variable.
    if (suffix) {
      const sl = this.line
      const sc = this.col
      for (let i = 0; i < suffix.length; i++) this.advance()
      this.push(TokenType.TypeSuffix, suffix, sl, sc, suffix.length)
    }
  }

  /**
   * Look ahead for a type suffix without consuming it: `$`, `.b`, `.w`, or a record
   * type `.RecordName` (only when RecordName is a known user type — that's why the
   * lexer is told the record names up front). `.b`/`.w` win over a record named
   * exactly "b"/"w" — but those can't exist (record names start uppercase here).
   */
  private peekTypeSuffix(): string | null {
    if (this.peek() === '$') return '$'
    if (this.peek() === '.' && (this.peek(1) === 'b' || this.peek(1) === 'w')) {
      // `.b`/`.w` only if NOT immediately followed by more identifier chars (so
      // `.bonus` is not mis-read as `.b` + `onus`); a record `.Bonus` is handled below.
      if (!isIdentPart(this.peek(2))) return '.' + this.peek(1)
    }
    if (this.peek() === '.' && isIdentStart(this.peek(1))) {
      // Read the candidate type name after the dot.
      let i = 1
      let name = ''
      while (isIdentPart(this.peek(i))) {
        name += this.peek(i)
        i++
      }
      if (this.recordNames.has(name)) return '.' + name
    }
    return null
  }

  private scanOperator(): void {
    const line = this.line
    const col = this.col
    let op = ''
    while (OP_CHARS.has(this.peek())) op += this.advance()
    this.push(TokenType.Operator, op, line, col, op.length)
  }
}

/**
 * Tokenize .crumb source into a classified token stream. The vocabulary (built by
 * buildVocabulary from the SSOT) drives identifier classification, so the lexer
 * knows exactly the words BreadCraft knows — nothing hardcoded.
 */
export function tokenize(source: string, vocabulary: VocabItem[]): Token[] {
  const classifier = buildClassifier(vocabulary)
  // Records are user-defined, so the lexer can't know `.Slot` is a type from the
  // SSOT alone. A first, record-blind pass finds every `Type <Name>`; the real pass
  // then knows those names and lexes `.Name` as a type suffix (user chose the strict
  // route: a typo'd record type fails to attach, surfacing the mistake).
  const recordNames = collectRecordNames(source, classifier)
  return new Scanner(source, classifier, recordNames).scan()
}

/**
 * First, record-blind lexer pass: collect the name after each `Type` keyword. Reuses
 * the real scanner (no duplicated whitespace/comment logic) — only the result is read.
 */
function collectRecordNames(source: string, classifier: Map<string, TokenType>): Set<string> {
  const names = new Set<string>()
  const tokens = new Scanner(source, classifier, new Set()).scan()
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]
    if (t.type === TokenType.Keyword && t.value.toLowerCase() === 'type') {
      const next = tokens[i + 1]
      if (next.type === TokenType.Identifier) names.add(next.value)
    }
  }
  return names
}

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
 * Map a vocabulary item's kind to the grammar class `classify(word)` reports to the
 * parser. A few names exist in the SSOT both as a constant and as a command/function
 * (TEXT, LEFT, RIGHT); the context-free classifier resolves the collision to
 * constant (constant-wins, see buildClassifier), and the parser refines by context.
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

/**
 * Build the canonical-spelling → grammar-class lookup, constant-wins on collisions.
 * The PARSER uses this to give a Word its role (memory: breadcraft-tokenizer-ssot);
 * the lexer only consults membership, to keep a canonical `$`-name (Left$, Chr$ …)
 * as a single token instead of splitting the `$` off as a type suffix.
 *
 * EISEN M2.T2 / N3: keyed by the EXACT canonical `name` — CRUMB is now case-sensitive
 * (Sprachdef §B.1). Only `If`/`Next`/`FIRE`/`Joystick` (exact) are CRUMB words; `next`,
 * `fire`, `IF` are free identifiers. That is what lets a variable be named `fire`
 * without colliding with the `FIRE` constant (arch D1–D4). The two-word aliases
 * (`End If`, `Else If` …) are not keys here — the normalizer fuses those before the
 * parser sees them.
 */
export function buildClassifier(vocabulary: VocabItem[]): Map<string, TokenType> {
  const map = new Map<string, TokenType>()
  const priority = (t: TokenType): number => (t === TokenType.Constant ? 2 : 1)
  for (const item of vocabulary) {
    const tt = kindToTokenType(item.kind)
    const existing = map.get(item.name)
    if (existing === undefined || priority(tt) > priority(existing)) {
      map.set(item.name, tt)
    }
  }
  return map
}

class Scanner {
  private readonly src: string
  private readonly classifier: Map<string, TokenType>
  private pos = 0
  private line = 1
  private col = 1
  private readonly tokens: Token[] = []

  constructor(src: string, classifier: Map<string, TokenType>) {
    this.src = src
    this.classifier = classifier
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

    // A trailing `$` may be PART OF A CANONICAL NAME (the string functions Left$,
    // Right$, Mid$, Chr$, Str$) or a TYPE SUFFIX on a variable (name$). This is the
    // one boundary the lexer needs the vocabulary for: if name+suffix is a known
    // word, keep it as ONE Word token; otherwise split the suffix off. That keeps
    // `Left$` whole (the parser later classifies it as a Function) while `name$`
    // becomes `name` + a `$` type suffix. (memory: breadcraft-functions-vs-statements)
    const suffix = this.peekTypeSuffix()
    if (suffix && this.classifier.has(name + suffix)) {
      for (let i = 0; i < suffix.length; i++) this.advance()
      this.push(TokenType.Word, name + suffix, line, col, name.length + suffix.length)
      return
    }

    // Every other identifier-shaped lexeme is just a Word — its grammar class is the
    // parser's job now (EISEN M2.T1), so the lexer no longer consults the vocabulary.
    this.push(TokenType.Word, name, line, col, name.length)

    // A trailing suffix that did NOT form a known name types the variable. A record
    // suffix `.Slot` is emitted blindly here (the lexer no longer knows the record
    // names — that double-scan is gone, N2); the parser/symbol-table validates that
    // the type actually exists.
    if (suffix) {
      const sl = this.line
      const sc = this.col
      for (let i = 0; i < suffix.length; i++) this.advance()
      this.push(TokenType.TypeSuffix, suffix, sl, sc, suffix.length)
    }
  }

  /**
   * Look ahead for a type suffix without consuming it: `$`, `.b`, `.w`, `.i`, or a
   * record type `.RecordName`. The lexer no longer knows which record names exist, so
   * ANY `.<name>` that is not the reserved `.b`/`.w`/`.i` reads as a record-type
   * suffix; the parser decides whether that record was actually declared (N2). The
   * reserved letters win over a record named exactly "b"/"w"/"i" — but those can't
   * exist (record names start uppercase here).
   */
  private peekTypeSuffix(): string | null {
    if (this.peek() === '$') return '$'
    if (
      this.peek() === '.' &&
      (this.peek(1) === 'b' || this.peek(1) === 'w' || this.peek(1) === 'i')
    ) {
      // `.b`/`.w`/`.i` (.i = signed int) only if NOT immediately followed by more
      // identifier chars (so `.item` is not mis-read as `.i` + `tem`, `.bonus` not
      // `.b` + `onus`); those longer names fall through to the record branch below.
      if (!isIdentPart(this.peek(2))) return '.' + this.peek(1)
    }
    if (this.peek() === '.' && isIdentStart(this.peek(1))) {
      // Read the candidate type name after the dot — any `.Name` is a record suffix.
      let i = 1
      let name = ''
      while (isIdentPart(this.peek(i))) {
        name += this.peek(i)
        i++
      }
      return '.' + name
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
 * The two-word block endings BreadCraft accepts, merged into their canonical single
 * keyword. STRICT canonical (Sprachdef §B.1 / EISEN N10): only the exact spelling
 * `End If` / `End Function` / `Else If` merges — `end if` stays two words so the
 * parser can answer with "meintest Du `End If`?". `End` and `Else` on their own are
 * untouched (the `End` command, the `Else` block opener).
 */
const MERGE_PAIRS: ReadonlyArray<{ first: string; second: string; into: string }> = [
  { first: 'End', second: 'If', into: 'EndIf' },
  { first: 'End', second: 'Function', into: 'EndFunction' },
  { first: 'Else', second: 'If', into: 'ElseIf' }
]

/**
 * Normalizer peephole: fuse the canonical two-word block endings into one keyword
 * token. Adjacency is what disambiguates `Else If` (one token apart → ElseIf) from
 * an `Else` block whose first statement is an `If` (`Else\nIf …` → a Newline sits
 * between them, so they do NOT fuse). Whitespace is not tokenized, so two words on
 * the same line are always immediately adjacent here.
 */
export function normalize(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const next = tokens[i + 1]
    const pair = next && MERGE_PAIRS.find((p) => p.first === t.value && p.second === next.value)
    if (pair) {
      out.push({
        type: TokenType.Keyword,
        value: pair.into,
        line: t.line,
        col: t.col,
        length: next.col - t.col + next.length
      })
      i++ // also consume the second word
      continue
    }
    out.push(t)
  }
  return out
}

/**
 * Tokenize .crumb source into a token stream. Every identifier-shaped lexeme is a
 * `Word`; the vocabulary is used only for the `$`-name boundary (Left$ et al.). The
 * grammar class of each Word is resolved later, in the parser (EISEN M2.T1).
 */
export function tokenize(source: string, vocabulary: VocabItem[]): Token[] {
  const classifier = buildClassifier(vocabulary)
  const tokens = new Scanner(source, classifier).scan()
  return normalize(tokens)
}

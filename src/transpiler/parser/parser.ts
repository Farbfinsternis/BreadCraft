import type { Token } from '../lexer/token'
import { TokenType } from '../lexer/token'
import type {
  Expr,
  Identifier,
  IndexExpr,
  FieldExpr,
  FieldDecl,
  Program,
  Statement,
  Pos
} from './ast'

// The .crumb parser: token stream → AST. Recursive descent at the statement level,
// a Pratt (precedence-climbing) parser for expressions. Like the lexer it NEVER
// throws — it records ParseError{message,line,col} and recovers to the next
// statement, so one mistake doesn't hide the rest of the file.
//
// Vertical slice (step 2): command statements, assignments, and full expressions
// with correct precedence (Sprachdef §D). Control flow / declarations are not yet
// parsed; a statement that starts with a keyword is reported as "not yet
// supported" with its position — the growth path is visible, never silent.

export interface ParseError extends Pos {
  message: string
}

export interface ParseResult {
  program: Program
  errors: ParseError[]
}

// Operator precedence as DATA (higher binds tighter), per Sprachdef §D:
//   Or/And  <  comparison  <  +/-  <  * / Mod. Unary (- Not) is handled separately.
// Word-operators (And/Or/Mod/Not/Xor/Shl/Shr) arrive as TokenType.Operator too,
// because the SSOT classifies them as kind 'operator'.
const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 1,
  '=': 2,
  '<>': 2,
  '<': 2,
  '>': 2,
  '<=': 2,
  '>=': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  mod: 4,
  shl: 4,
  shr: 4,
  xor: 4
}

const UNARY_OPS = new Set(['-', 'not'])

class Parser {
  private readonly tokens: Token[]
  private pos = 0
  private readonly errors: ParseError[] = []

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(ahead = 0): Token {
    const i = this.pos + ahead
    return this.tokens[i] ?? this.tokens[this.tokens.length - 1] // EOF is last
  }

  private advance(): Token {
    const t = this.tokens[this.pos]
    if (this.pos < this.tokens.length - 1) this.pos++
    return t
  }

  private atEnd(): boolean {
    return this.peek().type === TokenType.EOF
  }

  private error(message: string, at: Token): void {
    this.errors.push({ message, line: at.line, col: at.col })
  }

  /** True when the current token ends a statement (newline, ':', or EOF). */
  private atStatementEnd(): boolean {
    const t = this.peek().type
    return t === TokenType.Newline || t === TokenType.StatementSep || t === TokenType.EOF
  }

  /** Skip separators and comments between statements. */
  private skipSeparators(): void {
    for (;;) {
      const t = this.peek().type
      if (t === TokenType.Newline || t === TokenType.StatementSep || t === TokenType.Comment) {
        this.advance()
      } else {
        break
      }
    }
  }

  /** Recover after an error: consume up to (and including) the next separator. */
  private recover(): void {
    while (!this.atEnd() && !this.atStatementEnd()) this.advance()
  }

  parseProgram(): ParseResult {
    const body: Statement[] = []
    this.skipSeparators()
    while (!this.atEnd()) {
      const stmt = this.parseStatement()
      if (stmt) body.push(stmt)
      else this.recover()
      this.skipSeparators()
    }
    return { program: { kind: 'Program', body }, errors: this.errors }
  }

  // ---- statements ----

  private parseStatement(): Statement | null {
    const t = this.peek()

    if (t.type === TokenType.Keyword) {
      switch (t.value.toLowerCase()) {
        case 'if':
          return this.parseIf()
        case 'while':
          return this.parseWhile()
        case 'repeat':
          return this.parseRepeat()
        case 'for':
          return this.parseFor()
        case 'exit':
          this.advance()
          return { kind: 'ExitStmt', line: t.line, col: t.col }
        case 'global':
          return this.parseGlobal()
        case 'const':
          return this.parseConst()
        case 'dim':
          return this.parseDim()
        case 'type':
          return this.parseType()
        default:
          // Other keywords (Select, Function, Dim, …) are a later layer.
          this.error(
            `Anweisung beginnend mit '${t.value}' wird in diesem Schritt noch nicht unterstützt`,
            t
          )
          return null
      }
    }

    if (t.type === TokenType.Command) {
      return this.parseCommand()
    }
    if (t.type === TokenType.Identifier) {
      return this.parseAssignment()
    }

    // Constants, functions, etc. at statement start are not valid statements here.
    this.error(
      `Anweisung beginnend mit '${t.value || t.type}' wird in diesem Schritt noch nicht unterstützt`,
      t
    )
    return null
  }

  /** True if the current token is a keyword whose name (lowercased) is in `names`. */
  private atKeyword(...names: string[]): boolean {
    const t = this.peek()
    return t.type === TokenType.Keyword && names.includes(t.value.toLowerCase())
  }

  /**
   * Parse statements until a terminator keyword is at the statement start (the
   * terminator is NOT consumed). Stops at EOF too. Used for every block body.
   */
  private parseBlock(terminators: string[]): Statement[] {
    const body: Statement[] = []
    this.skipSeparators()
    while (!this.atEnd() && !this.atKeyword(...terminators)) {
      const stmt = this.parseStatement()
      if (stmt) body.push(stmt)
      else this.recover()
      this.skipSeparators()
    }
    return body
  }

  /** Consume a terminator keyword, or record an error if it's missing. */
  private expectKeyword(name: string): void {
    if (this.atKeyword(name.toLowerCase())) this.advance()
    else this.error(`'${name}' erwartet`, this.peek())
  }

  private parseIf(): Statement {
    const kw = this.advance() // If
    const cond = this.parseExpr(0)

    // Single-line form: `If <cond> Then <statement>`.
    if (this.atKeyword('then')) {
      this.advance()
      const then: Statement[] = []
      const s = this.parseStatement()
      if (s) then.push(s)
      return { kind: 'IfStmt', cond, then, elifs: [], line: kw.line, col: kw.col }
    }

    // Block form: … [ElseIf …]* [Else …] EndIf
    const then = this.parseBlock(['elseif', 'else', 'endif'])
    const elifs: { cond: Expr; body: Statement[] }[] = []
    while (this.atKeyword('elseif')) {
      this.advance()
      const c = this.parseExpr(0)
      const b = this.parseBlock(['elseif', 'else', 'endif'])
      elifs.push({ cond: c, body: b })
    }
    let elseBody: Statement[] | undefined
    if (this.atKeyword('else')) {
      this.advance()
      elseBody = this.parseBlock(['endif'])
    }
    this.expectKeyword('EndIf')
    return { kind: 'IfStmt', cond, then, elifs, else: elseBody, line: kw.line, col: kw.col }
  }

  private parseWhile(): Statement {
    const kw = this.advance() // While
    const cond = this.parseExpr(0)
    const body = this.parseBlock(['wend'])
    this.expectKeyword('Wend')
    return { kind: 'WhileStmt', cond, body, line: kw.line, col: kw.col }
  }

  private parseRepeat(): Statement {
    const kw = this.advance() // Repeat
    const body = this.parseBlock(['until'])
    this.expectKeyword('Until')
    const until = this.parseExpr(0)
    return { kind: 'RepeatStmt', body, until, line: kw.line, col: kw.col }
  }

  private parseFor(): Statement {
    const kw = this.advance() // For
    const variable = this.parseIdentifier()
    if (this.peek().type === TokenType.Operator && this.peek().value === '=') {
      this.advance()
    } else {
      this.error("'=' erwartet in For-Schleife", this.peek())
    }
    const from = this.parseExpr(0)
    this.expectKeyword('To')
    const to = this.parseExpr(0)
    let step: Expr | undefined
    if (this.atKeyword('step')) {
      this.advance()
      step = this.parseExpr(0)
    }
    const body = this.parseBlock(['next'])
    this.expectKeyword('Next')
    return { kind: 'ForStmt', variable, from, to, step, body, line: kw.line, col: kw.col }
  }

  private parseCommand(): Statement {
    const nameTok = this.advance() // the Command token
    const args: Expr[] = []

    // Optional parentheses around the whole argument list (Klammern optional, §5.2).
    const wrapped = this.peek().type === TokenType.LParen
    if (wrapped) this.advance()

    const listEnd = (): boolean =>
      wrapped ? this.peek().type === TokenType.RParen : this.atStatementEnd()

    if (!listEnd()) {
      args.push(this.parseExpr(0))
      while (this.peek().type === TokenType.Comma) {
        this.advance()
        args.push(this.parseExpr(0))
      }
    }

    if (wrapped) {
      if (this.peek().type === TokenType.RParen) this.advance()
      else this.error("')' erwartet", this.peek())
    }

    return {
      kind: 'CommandStmt',
      name: nameTok.value,
      args,
      line: nameTok.line,
      col: nameTok.col
    }
  }

  private parseAssignment(): Statement | null {
    const target = this.parseIdentifierOrIndex()
    const opTok = this.peek()
    if (opTok.type !== TokenType.Operator || opTok.value !== '=') {
      this.error("'=' erwartet (nur Zuweisungen werden in diesem Schritt unterstützt)", opTok)
      return null
    }
    this.advance() // '='
    const value = this.parseExpr(0)
    return { kind: 'AssignStmt', target, value, line: target.line, col: target.col }
  }

  /** `Global name.typ = wert` — init is mandatory (Sprachdef §C). */
  private parseGlobal(): Statement | null {
    const kw = this.advance() // Global
    const target = this.parseIdentifier()
    const opTok = this.peek()
    if (opTok.type !== TokenType.Operator || opTok.value !== '=') {
      this.error("'=' erwartet — Global braucht eine Pflicht-Initialisierung", opTok)
      return null
    }
    this.advance() // '='
    const value = this.parseExpr(0)
    return { kind: 'GlobalStmt', target, value, line: kw.line, col: kw.col }
  }

  /** `Const NAME = wert` — compile-time constant; no type suffix (Sprachdef §C). */
  private parseConst(): Statement | null {
    const kw = this.advance() // Const
    const nameTok = this.peek()
    if (nameTok.type !== TokenType.Identifier) {
      this.error("Name erwartet nach 'Const'", nameTok)
      return null
    }
    this.advance()
    const opTok = this.peek()
    if (opTok.type !== TokenType.Operator || opTok.value !== '=') {
      this.error("'=' erwartet in Const-Deklaration", opTok)
      return null
    }
    this.advance() // '='
    const value = this.parseExpr(0)
    return { kind: 'ConstStmt', name: nameTok.value, value, line: kw.line, col: kw.col }
  }

  /**
   * `Dim feld.typ[N]` (1D) or `Dim feld.typ[breite, hoehe]` (2D). The sizes are
   * expressions (literal/Const); 1 or 2 dimensions only — see Sprachdef §C.
   *
   * 2D is the deliberate ceiling on the C64: the 6502 has no hardware multiply, so
   * every array index is a software cost. 2D needs ONE multiply (and a constant
   * width gets optimized to shifts); 3D+ needs several multiplies per access AND
   * invites RAM blowups (e.g. [40,25,10] = 10000 bytes). Unlike BASSM/Amiga (which
   * has a hardware MULU), nD here would hide a real cost — so it's an honest error,
   * not a silent gap. (memory: c64-math-cost-model)
   */
  private parseDim(): Statement | null {
    const kw = this.advance() // Dim
    const target = this.parseIdentifier()
    if (this.peek().type !== TokenType.LBracket) {
      this.error("'[' erwartet — Dim braucht eine Größenangabe, z. B. Dim feld.b[10]", this.peek())
      return null
    }
    const sizes = this.parseBracketList()
    if (sizes.length < 1) {
      this.error('Dim braucht mindestens eine Dimension, z. B. Dim feld.b[10]', kw)
    } else if (sizes.length > 2) {
      this.error(
        'Der C64 unterstützt nur 1- und 2-dimensionale Arrays. Mehr Dimensionen brauchen ' +
          'pro Zugriff mehrere Multiplikationen (der 6502 hat keine Hardware-Multiplikation) ' +
          'und kosten schnell sehr viel RAM. Lege stattdessen ein 2D-Array an und rechne die ' +
          'dritte Dimension selbst in den Index (so bleibt die Kostenrechnung sichtbar).',
        kw
      )
    }
    return { kind: 'DimStmt', target, sizes, line: kw.line, col: kw.col }
  }

  /**
   * A record definition (Sprachdef §C):
   *   Type Slot
   *     Field item.b
   *     Field count.b
   *   EndType
   * Each Field is a name + type suffix. Maps to a C struct in CodeGen.
   */
  private parseType(): Statement | null {
    const kw = this.advance() // Type
    const nameTok = this.peek()
    if (nameTok.type !== TokenType.Identifier) {
      this.error("Name erwartet nach 'Type'", nameTok)
      return null
    }
    this.advance()
    const fields: FieldDecl[] = []
    this.skipSeparators()
    while (!this.atEnd() && !this.atKeyword('endtype')) {
      if (this.atKeyword('field')) {
        this.advance() // Field
        const fNameTok = this.peek()
        if (fNameTok.type === TokenType.Identifier) {
          this.advance()
          let suffix: string | undefined
          if (this.peek().type === TokenType.TypeSuffix) suffix = this.advance().value
          fields.push({ name: fNameTok.value, suffix })
        } else {
          this.error("Feldname erwartet nach 'Field'", fNameTok)
          this.recover()
        }
      } else {
        this.error("'Field' oder 'EndType' erwartet im Type-Block", this.peek())
        this.recover()
      }
      this.skipSeparators()
    }
    this.expectKeyword('EndType')
    return { kind: 'TypeDecl', name: nameTok.value, fields, line: kw.line, col: kw.col }
  }

  /**
   * Parse a `[ expr (, expr)* ]` list (array sizes or indices). Assumes the current
   * token is '['. Always consumes the matching ']' (error if missing).
   */
  private parseBracketList(): Expr[] {
    this.advance() // '['
    const items: Expr[] = []
    if (this.peek().type !== TokenType.RBracket) {
      items.push(this.parseExpr(0))
      while (this.peek().type === TokenType.Comma) {
        this.advance()
        items.push(this.parseExpr(0))
      }
    }
    if (this.peek().type === TokenType.RBracket) this.advance()
    else this.error("']' erwartet", this.peek())
    return items
  }

  // ---- expressions (Pratt) ----

  private parseExpr(minBp: number): Expr {
    let left = this.parseUnary()

    for (;;) {
      const t = this.peek()
      if (t.type !== TokenType.Operator) break
      const bp = BINARY_PRECEDENCE[t.value.toLowerCase()]
      if (bp === undefined || bp < minBp) break
      this.advance()
      // Left-associative: parse the right side with a higher minimum.
      const right = this.parseExpr(bp + 1)
      left = { kind: 'Binary', op: t.value, left, right, line: left.line, col: left.col }
    }
    return left
  }

  private parseUnary(): Expr {
    const t = this.peek()
    if (t.type === TokenType.Operator && UNARY_OPS.has(t.value.toLowerCase())) {
      this.advance()
      const expr = this.parseUnary()
      return { kind: 'Unary', op: t.value, expr, line: t.line, col: t.col }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    switch (t.type) {
      case TokenType.NumberDec:
        this.advance()
        return { kind: 'NumberLit', raw: t.value, base: 'dec', line: t.line, col: t.col }
      case TokenType.NumberHex:
        this.advance()
        return { kind: 'NumberLit', raw: t.value, base: 'hex', line: t.line, col: t.col }
      case TokenType.NumberBin:
        this.advance()
        return { kind: 'NumberLit', raw: t.value, base: 'bin', line: t.line, col: t.col }
      case TokenType.String:
        this.advance()
        return { kind: 'StringLit', value: t.value, line: t.line, col: t.col }
      case TokenType.Constant:
        this.advance()
        return { kind: 'ConstantRef', name: t.value, line: t.line, col: t.col }
      case TokenType.Function:
        return this.parseCall()
      case TokenType.Identifier:
        return this.parseIdentifierOrIndex()
      case TokenType.LParen: {
        this.advance()
        const inner = this.parseExpr(0)
        if (this.peek().type === TokenType.RParen) this.advance()
        else this.error("')' erwartet", this.peek())
        return { kind: 'Grouping', expr: inner, line: t.line, col: t.col }
      }
      default:
        // Nothing valid here — record and synthesize a zero so parsing can go on.
        this.error(`Ausdruck erwartet, '${t.value || t.type}' gefunden`, t)
        if (!this.atStatementEnd()) this.advance()
        return { kind: 'NumberLit', raw: '0', base: 'dec', line: t.line, col: t.col }
    }
  }

  private parseCall(): Expr {
    const nameTok = this.advance() // Function token (callee, e.g. Left$)
    const args: Expr[] = []
    if (this.peek().type === TokenType.LParen) {
      this.advance()
      if (this.peek().type !== TokenType.RParen) {
        args.push(this.parseExpr(0))
        while (this.peek().type === TokenType.Comma) {
          this.advance()
          args.push(this.parseExpr(0))
        }
      }
      if (this.peek().type === TokenType.RParen) this.advance()
      else this.error("')' erwartet", this.peek())
    } else {
      // Functions require parentheses (Konvention §E).
      this.error(`'(' erwartet nach Funktion '${nameTok.value}'`, this.peek())
    }
    return { kind: 'CallExpr', callee: nameTok.value, args, line: nameTok.line, col: nameTok.col }
  }

  private parseIdentifier(): Identifier {
    const nameTok = this.advance()
    let suffix: string | undefined
    if (this.peek().type === TokenType.TypeSuffix) {
      suffix = this.advance().value
    }
    return {
      kind: 'Identifier',
      name: nameTok.value,
      suffix,
      line: nameTok.line,
      col: nameTok.col
    }
  }

  /**
   * An identifier optionally followed by an index list and/or a record field:
   * `feld` → Identifier, `feld[i]` → IndexExpr, `tasche[3]\count` / `p\x` → FieldExpr.
   * A type suffix and an index are mutually exclusive (`feld[i]` indexes; `score.w`
   * types) — an array element has no suffix.
   */
  private parseIdentifierOrIndex(): Identifier | IndexExpr | FieldExpr {
    const id = this.parseIdentifier()
    let base: Identifier | IndexExpr = id
    if (this.peek().type === TokenType.LBracket) {
      const indices = this.parseBracketList()
      base = { kind: 'IndexExpr', name: id.name, indices, line: id.line, col: id.col }
    }
    // Record field access: base\field (Sprachdef §C).
    if (this.peek().type === TokenType.Backslash) {
      this.advance() // '\'
      const fieldTok = this.peek()
      if (fieldTok.type === TokenType.Identifier) {
        this.advance()
        return { kind: 'FieldExpr', base, field: fieldTok.value, line: id.line, col: id.col }
      }
      this.error("Feldname erwartet nach '\\'", fieldTok)
    }
    return base
  }
}

/** Parse a .crumb token stream into an AST. Never throws; errors are collected. */
export function parse(tokens: Token[]): ParseResult {
  return new Parser(tokens).parseProgram()
}

import type { VocabItem } from '@shared/ssot-types'
import type { Token } from '../lexer/token'
import { TokenType } from '../lexer/token'
import { buildClassifier } from '../lexer'
import type {
  Expr,
  Identifier,
  IndexExpr,
  FieldExpr,
  FieldDecl,
  ParamDecl,
  Program,
  Statement,
  Pos
} from './ast'

// The .crumb parser: token stream → AST. Recursive descent at the statement level,
// a Pratt (precedence-climbing) parser for expressions. Like the lexer it NEVER
// throws — it records ParseError{message,line,col} and recovers to the next
// statement, so one mistake doesn't hide the rest of the file.
//
// Covers command statements, assignments, full expressions with correct precedence
// (Sprachdef §D), control flow (If/While/Repeat/For/Exit), and declarations
// (Global/Const/Dim/Type, Function/Return). A statement starting with a not-yet-
// supported keyword (e.g. Select) is reported with its position — the growth path is
// visible, never silent.

export interface ParseError extends Pos {
  message: string
}

export interface ParseResult {
  program: Program
  errors: ParseError[]
}

// Operator precedence as DATA (higher binds tighter), per Sprachdef §D:
//   Or/And  <  comparison  <  +/-  <  * / Mod. Unary (- Not) is handled separately.
// Word-operators (And/Or/Mod/Not/Xor/Shl/Shr) arrive as plain Word tokens; `eff`
// classifies them to TokenType.Operator (the SSOT lists them as kind 'operator').
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
  /** Exact canonical spelling → grammar class, the SSOT-fed bridge that replaces the
   *  lexer's former classification (EISEN M2.T1). `eff` consults it to give a Word its
   *  role. Case-SENSITIVE since M2.T2/N3: only `If`/`FIRE`/`Next` (exact) are keys. */
  private readonly classifier: Map<string, TokenType>
  /** lowercased spelling → canonical spelling, for the "meintest Du `If`?" hint when a
   *  word is a CRUMB word in the wrong case (M2.T2). */
  private readonly canonical: Map<string, string>
  private pos = 0
  private readonly errors: ParseError[] = []
  /** True while parsing a function body — used to forbid nested Function defs and to
   *  flag a `Return` that sits outside any function (Sprachdef §C.1: top-level only). */
  private inFunction = false

  constructor(tokens: Token[], vocabulary: VocabItem[]) {
    this.tokens = tokens
    this.classifier = buildClassifier(vocabulary)
    this.canonical = new Map()
    for (const item of vocabulary) {
      const key = item.name.toLowerCase()
      if (!this.canonical.has(key)) this.canonical.set(key, item.name)
    }
  }

  /**
   * The EFFECTIVE grammar class of a token. A `Word` carries no class of its own —
   * the SSOT classifier decides whether it is a Keyword/Command/Function/Constant/
   * Operator, falling back to Identifier for words BreadCraft doesn't know. Every
   * other token (literals, punctuation, the symbol Operator from the char scanner)
   * is already its own class, so it passes through unchanged. This is the single
   * seam that moved classification off the lexer and onto the parser, keeping the
   * resulting AST identical to before for canonically-spelled code.
   *
   * EISEN M2.T2 / N3: the lookup is now case-SENSITIVE (Sprachdef §B.1). A Word is a
   * CRUMB keyword/command/constant only in its exact canonical spelling — `If`, `FIRE`,
   * `Next`; `next`/`fire`/`IF` fall through to Identifier and so can be variables
   * (arch D1–D4).
   */
  private eff(t: Token): TokenType {
    if (t.type !== TokenType.Word) return t.type
    return this.classifier.get(t.value) ?? TokenType.Identifier
  }

  /**
   * True if the token is the EXACT canonical spelling of a CRUMB word — reserved, so
   * it cannot be declared or assigned to (Sprachdef §B.1, N1). `Next`, `FIRE`, `If`
   * are reserved; `next`, `fire`, `iff` are free identifiers.
   */
  private isReserved(t: Token): boolean {
    return t.type === TokenType.Word && this.classifier.has(t.value)
  }

  /** Record the "`X` is a CRUMB word" error for a reserved word used as a name. */
  private reservedError(t: Token, role: string): void {
    this.error(
      `'${t.value}' ist ein CRUMB-Wort und kann kein ${role} sein — schreib es z. B. klein (${t.value.toLowerCase()})`,
      t
    )
  }

  /**
   * The canonical spelling to suggest when a word is a CRUMB KEYWORD typed in the
   * wrong case (`if` → `If`, `endif` → `EndIf`). Only structural keywords are
   * suggested: a miscased command could be a legitimate user-function name under
   * case-sensitivity, so its call is not hijacked. Returns undefined otherwise.
   */
  private keywordTypo(t: Token): string | undefined {
    if (t.type !== TokenType.Word) return undefined
    const canon = this.canonical.get(t.value.toLowerCase())
    if (!canon || canon === t.value) return undefined
    return this.classifier.get(canon) === TokenType.Keyword ? canon : undefined
  }

  /**
   * Consume a user-defined NAME in a declaration position (Const/Type/Function/param/
   * field). It must be a non-reserved Word (Sprachdef §B.1, N1). Records an error and
   * returns null otherwise; the caller recovers.
   */
  private takeName(role: string): Token | null {
    const t = this.peek()
    if (t.type !== TokenType.Word) {
      this.error(`${role} erwartet`, t)
      return null
    }
    if (this.classifier.has(t.value)) {
      this.reservedError(t, role)
      return null
    }
    return this.advance()
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
    const et = this.eff(t)

    // Assignment shape (`name = …`, `name[…] = …`, `name\f = …`) is checked FIRST so a
    // reserved word as a target gives the precise "CRUMB-Wort" error instead of the
    // generic keyword path; a non-reserved word here is a normal assignment (fire = 1).
    if (t.type === TokenType.Word && this.looksLikeAssignment()) {
      if (this.classifier.has(t.value)) {
        this.reservedError(t, 'Zuweisungsziel')
        return null
      }
      return this.parseAssignment()
    }

    if (et === TokenType.Keyword) {
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
        case 'function':
          return this.parseFunction()
        case 'return':
          return this.parseReturn()
        default:
          // Other keywords (Select, …) are a later layer.
          this.error(
            `Anweisung beginnend mit '${t.value}' wird in diesem Schritt noch nicht unterstützt`,
            t
          )
          return null
      }
    }

    if (et === TokenType.Command) {
      return this.parseCommand()
    }
    // A bare word that is neither a structure keyword nor a command and is not an
    // assignment target: a statement-function call (`Heal 5`, no parens). But first
    // catch a miscased CRUMB keyword — the case-sensitivity trap — and help instead
    // of silently calling a function named `if`.
    if (t.type === TokenType.Word) {
      const canon = this.keywordTypo(t)
      if (canon) {
        this.error(
          `'${t.value}' ist kein CRUMB-Wort — meintest Du '${canon}'? CRUMB unterscheidet Groß- und Kleinschreibung`,
          t
        )
        return null
      }
      return this.parseCallStatement()
    }

    // Punctuation/literal at statement start — not a valid statement.
    this.error(
      `Anweisung beginnend mit '${t.value || t.type}' wird in diesem Schritt noch nicht unterstützt`,
      t
    )
    return null
  }

  /** True if the current token is a keyword whose name (lowercased) is in `names`. */
  private atKeyword(...names: string[]): boolean {
    const t = this.peek()
    return this.eff(t) === TokenType.Keyword && names.includes(t.value.toLowerCase())
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

  /**
   * One If routine for every shape (EISEN M2.T3). `Then` is an optional filler word;
   * what comes AFTER the head decides the form, not whether `Then` was written:
   *   - a Newline → BLOCK form: bodies run over the following lines until
   *     ElseIf/Else/EndIf, and EndIf is required.
   *   - anything else → INLINE form: a `:`-separated chain on this line, ending at
   *     ElseIf/Else/EndIf or the line's end; a trailing EndIf is optional.
   * This unifies the four shapes the arch cases pin down (A1–A4) instead of the old
   * "Then ⇒ exactly one statement, no EndIf" special case that broke `Then`+Newline.
   */
  private parseIf(): Statement {
    const kw = this.advance() // If
    const cond = this.parseExpr(0)
    if (this.atKeyword('then')) this.advance() // 'Then' is optional filler

    const inline = this.peek().type !== TokenType.Newline
    const readBody = (terminators: string[]): Statement[] =>
      inline ? this.parseInlineBody(terminators) : this.parseBlock(terminators)

    const then = readBody(['elseif', 'else', 'endif'])
    const elifs: { cond: Expr; body: Statement[] }[] = []
    while (this.atKeyword('elseif')) {
      this.advance()
      const c = this.parseExpr(0)
      if (this.atKeyword('then')) this.advance()
      elifs.push({ cond: c, body: readBody(['elseif', 'else', 'endif']) })
    }
    let elseBody: Statement[] | undefined
    if (this.atKeyword('else')) {
      this.advance()
      elseBody = readBody(['endif'])
    }
    // Block form requires EndIf; inline form makes it optional (it may simply end with
    // the line, as in `If x > 0 Then x = 2`).
    if (inline) {
      if (this.atKeyword('endif')) this.advance()
    } else {
      this.expectKeyword('EndIf')
    }
    return { kind: 'IfStmt', cond, then, elifs, else: elseBody, line: kw.line, col: kw.col }
  }

  /**
   * An inline statement body: a `:`-separated chain on the current line, stopping at a
   * terminator keyword (ElseIf/Else/EndIf) or the end of the line (Newline/EOF). The
   * reusable counterpart to parseBlock for single-line constructs (later also one-line
   * While/For — not in EISEN). Leading/inner `:` separators are consumed.
   */
  private parseInlineBody(terminators: string[]): Statement[] {
    const body: Statement[] = []
    while (this.peek().type === TokenType.StatementSep) this.advance()
    while (
      !this.atEnd() &&
      this.peek().type !== TokenType.Newline &&
      !this.atKeyword(...terminators)
    ) {
      const s = this.parseStatement()
      if (s) body.push(s)
      else {
        this.recover()
        break
      }
      while (this.peek().type === TokenType.StatementSep) this.advance()
    }
    return body
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
    if (this.isReserved(this.peek())) this.reservedError(this.peek(), 'Schleifenvariable')
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

  // ---- argument lists (one routine, EISEN M2.T4) ----

  /** Parse `( expr (, expr)* )` — the current token must be '('. Always consumes the
   *  matching ')'. Shared by the optional-parens command/statement-fn form and the
   *  mandatory-parens value-function call. */
  private parseParenArgs(): Expr[] {
    this.advance() // '('
    const args: Expr[] = []
    if (this.peek().type !== TokenType.RParen) {
      args.push(this.parseExpr(0))
      while (this.peek().type === TokenType.Comma) {
        this.advance()
        args.push(this.parseExpr(0))
      }
    }
    if (this.peek().type === TokenType.RParen) this.advance()
    else this.error("')' erwartet", this.peek())
    return args
  }

  /** Parse a bare, unparenthesized `expr (, expr)*` up to the end of the statement. */
  private parseBareArgs(): Expr[] {
    const args: Expr[] = []
    if (!this.atStatementEnd()) {
      args.push(this.parseExpr(0))
      while (this.peek().type === TokenType.Comma) {
        this.advance()
        args.push(this.parseExpr(0))
      }
    }
    return args
  }

  /**
   * Does the '(' at the cursor wrap the WHOLE argument list (its matching ')' sitting
   * at the end of the statement)? If a ',' (or anything else) follows that ')', the
   * parens were just a grouped FIRST argument — the E2 case `DrawText (1), 2, "hi"`.
   * One-token lookahead past the matching ')'. (Brackets `[…]` don't change paren
   * depth, so a 2D index inside the list is counted correctly.)
   */
  private wrapsWholeList(): boolean {
    let depth = 0
    for (let i = 0; ; i++) {
      const t = this.peek(i)
      if (t.type === TokenType.EOF) return false
      if (t.type === TokenType.LParen) depth++
      else if (t.type === TokenType.RParen && --depth === 0) {
        const after = this.peek(i + 1).type
        return (
          after === TokenType.Newline ||
          after === TokenType.StatementSep ||
          after === TokenType.EOF
        )
      }
    }
  }

  /**
   * Command / statement-function arguments: optional wrapping parens (`Cls(BLACK)`,
   * `Heal(5, 3)`) OR a bare list (`Graphics TEXT, MULTICOLOR`, `Heal 5`). A leading '('
   * wraps only when it spans the whole list; otherwise it's a grouped first argument.
   */
  private parseArgs(): Expr[] {
    if (this.peek().type === TokenType.LParen && this.wrapsWholeList()) {
      return this.parseParenArgs()
    }
    return this.parseBareArgs()
  }

  private parseCommand(): Statement {
    const nameTok = this.advance() // the Command token
    return {
      kind: 'CommandStmt',
      name: nameTok.value,
      args: this.parseArgs(),
      line: nameTok.line,
      col: nameTok.col
    }
  }

  /**
   * Lookahead: does a statement starting with an identifier look like an assignment
   * (vs a statement-call)? The target of an assignment is `name`, optionally with an
   * index `[…]` and/or a field `\f`, then `=`. So if the token right after the name
   * is `[`, `\`, or `=`, it's an assignment; anything else (args or end of statement)
   * is a statement-call. (`name.suffix =` also lands here — the suffix is part of the
   * name token's following TypeSuffix, so we peek past it.)
   */
  private looksLikeAssignment(): boolean {
    let i = 1 // token after the name
    if (this.peek(i).type === TokenType.TypeSuffix) i++ // skip `.b`/`.w`/`$`
    const next = this.peek(i).type
    if (next === TokenType.LBracket || next === TokenType.Backslash) return true
    return next === TokenType.Operator && this.peek(i).value === '='
  }

  /** A statement-function call: `Heal 5`, `Heal(5)`, or `Heal(5, 3)`. Same argument
   *  shape as a command (one parseArgs routine); the callee is a user function name.
   *  Value-functions are called in expressions (CallExpr), not here. */
  private parseCallStatement(): Statement {
    const nameTok = this.advance() // the function name
    return {
      kind: 'CallStmt',
      callee: nameTok.value,
      args: this.parseArgs(),
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
    if (this.isReserved(this.peek())) {
      this.reservedError(this.peek(), 'Variablenname')
      return null
    }
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
    const nameTok = this.takeName('Name')
    if (!nameTok) return null
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
    if (this.isReserved(this.peek())) {
      this.reservedError(this.peek(), 'Arrayname')
      return null
    }
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
    const nameTok = this.takeName('Typname')
    if (!nameTok) return null
    const fields: FieldDecl[] = []
    this.skipSeparators()
    while (!this.atEnd() && !this.atKeyword('endtype')) {
      if (this.atKeyword('field')) {
        this.advance() // Field
        const fNameTok = this.takeName('Feldname')
        if (fNameTok) {
          let suffix: string | undefined
          if (this.peek().type === TokenType.TypeSuffix) suffix = this.advance().value
          fields.push({ name: fNameTok.value, suffix })
        } else {
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
   * A function definition (Sprachdef §C.1):
   *   Function Distance.w(x1.b, y1.b)   ; .w on the name = returns a word
   *     ... : Return d.w
   *   EndFunction
   * The name may collide with an SSOT word (isName, like Const/Type). The return type
   * is the suffix on the name (none = statement-function). Params are `name [suffix]`,
   * comma-separated, possibly empty. Nesting is forbidden (top-level only).
   */
  private parseFunction(): Statement | null {
    const kw = this.advance() // Function
    if (this.inFunction) {
      this.error('Funktionen dürfen nicht ineinander verschachtelt werden', kw)
      // Recover: skip to the matching EndFunction so the rest of the file still parses.
      this.skipToKeyword('endfunction')
      return null
    }

    const nameTok = this.takeName('Funktionsname')
    if (!nameTok) return null
    // Return type = optional suffix on the name (.b/.w/$). None = no return value.
    let returnSuffix: string | undefined
    if (this.peek().type === TokenType.TypeSuffix) returnSuffix = this.advance().value

    const params = this.parseParamList()

    this.inFunction = true
    const body = this.parseBlock(['endfunction'])
    this.inFunction = false
    this.expectKeyword('EndFunction')

    return {
      kind: 'FunctionDecl',
      name: nameTok.value,
      returnSuffix,
      params,
      body,
      line: kw.line,
      col: kw.col
    }
  }

  /** Parse `( name[.suffix] (, name[.suffix])* )`. Empty list and a missing pair of
   *  parens both recover with an error — the body still parses either way. */
  private parseParamList(): ParamDecl[] {
    const params: ParamDecl[] = []
    if (this.peek().type !== TokenType.LParen) {
      this.error("'(' erwartet nach dem Funktionsnamen (auch leer: Name())", this.peek())
      return params
    }
    this.advance() // '('
    if (this.peek().type !== TokenType.RParen) {
      for (;;) {
        const nameTok = this.takeName('Parametername')
        if (!nameTok) break
        let suffix: string | undefined
        if (this.peek().type === TokenType.TypeSuffix) suffix = this.advance().value
        params.push({ name: nameTok.value, suffix })
        if (this.peek().type === TokenType.Comma) {
          this.advance()
          continue
        }
        break
      }
    }
    if (this.peek().type === TokenType.RParen) this.advance()
    else this.error("')' erwartet am Ende der Parameterliste", this.peek())
    return params
  }

  /** `Return [expr]` — value present in a value-function, absent for an early exit. */
  private parseReturn(): Statement | null {
    const kw = this.advance() // Return
    if (!this.inFunction) {
      this.error("'Return' steht außerhalb einer Funktion", kw)
      // not fatal — keep parsing, but still consume an optional expression below
    }
    let value: Expr | undefined
    if (!this.atStatementEnd() && !this.atKeyword('endfunction')) {
      value = this.parseExpr(0)
    }
    return { kind: 'ReturnStmt', value, line: kw.line, col: kw.col }
  }

  /** Recover past a block: consume tokens until (and including) the given terminator
   *  keyword, or EOF. Used when a Function is illegally nested. */
  private skipToKeyword(name: string): void {
    while (!this.atEnd() && !this.atKeyword(name)) this.advance()
    if (this.atKeyword(name)) this.advance()
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
      if (this.eff(t) !== TokenType.Operator) break
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
    if (this.eff(t) === TokenType.Operator && UNARY_OPS.has(t.value.toLowerCase())) {
      this.advance()
      const expr = this.parseUnary()
      return { kind: 'Unary', op: t.value, expr, line: t.line, col: t.col }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    switch (this.eff(t)) {
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
        // A user-defined value-function call: `Distance(a, b)` — an identifier
        // directly followed by '('. (Index `feld[i]` and field `p\x` are handled by
        // parseIdentifierOrIndex; only '(' means a call.) Parens are mandatory for a
        // value function (SSOT convention), so this is the only expression call form.
        if (this.peek(1).type === TokenType.LParen) return this.parseCall()
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
    // Value-functions require parentheses (Konvention §E) — always a whole-list wrap.
    let args: Expr[] = []
    if (this.peek().type === TokenType.LParen) {
      args = this.parseParenArgs()
    } else {
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
    // Record field access: base\field (Sprachdef §C). After '\' it is always a field
    // name in the record's own namespace, so any Word goes (case-sensitivity already
    // keeps `count` distinct from a CRUMB word); codegen checks the field exists.
    if (this.peek().type === TokenType.Backslash) {
      this.advance() // '\'
      const fieldTok = this.peek()
      if (fieldTok.type === TokenType.Word) {
        this.advance()
        return { kind: 'FieldExpr', base, field: fieldTok.value, line: id.line, col: id.col }
      }
      this.error("Feldname erwartet nach '\\'", fieldTok)
    }
    return base
  }
}

/**
 * Parse a .crumb token stream into an AST. Never throws; errors are collected. The
 * vocabulary classifies each `Word` token by context (the bridge that moved grammar
 * classification off the lexer, EISEN M2.T1) — pass the same SSOT vocabulary used to
 * tokenize.
 */
export function parse(tokens: Token[], vocabulary: VocabItem[]): ParseResult {
  return new Parser(tokens, vocabulary).parseProgram()
}

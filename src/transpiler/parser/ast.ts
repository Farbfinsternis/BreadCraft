// The .crumb AST — the parser's output, the code generator's input. Minimal but
// architecturally real: every node carries a `kind` discriminator (so CodeGen and
// tests can switch type-safely) and a source position (line/col from its first
// token, for later error reporting and source maps). New language constructs are
// added as new node kinds; existing ones never change shape (vertical-slice rule,
// memory: breadcraft-define-everything-first).

/** 1-based source position, copied from the node's starting token. */
export interface Pos {
  line: number
  col: number
}

// ---- Expressions ----

export type NumberBase = 'dec' | 'hex' | 'bin'

export interface NumberLit extends Pos {
  kind: 'NumberLit'
  /** Raw digits as written (without the $/% prefix); base says how to read them. */
  raw: string
  base: NumberBase
}

export interface StringLit extends Pos {
  kind: 'StringLit'
  value: string
}

/** A reference to an SSOT constant (e.g. TEXT, MULTICOLOR, LEFT, BLACK). */
export interface ConstantRef extends Pos {
  kind: 'ConstantRef'
  name: string
}

/** A variable/identifier, with an optional type suffix (.b/.w/$) as written. */
export interface Identifier extends Pos {
  kind: 'Identifier'
  name: string
  suffix?: string
}

export interface Unary extends Pos {
  kind: 'Unary'
  op: string
  expr: Expr
}

export interface Binary extends Pos {
  kind: 'Binary'
  op: string
  left: Expr
  right: Expr
}

/** Parenthesized grouping — kept in the AST so precedence is faithfully preserved. */
export interface Grouping extends Pos {
  kind: 'Grouping'
  expr: Expr
}

/** A function call in an expression, e.g. Left$(s$, 3) or Joystick(0). */
export interface CallExpr extends Pos {
  kind: 'CallExpr'
  /** The function's canonical name (incl. any $ that is part of the name). */
  callee: string
  args: Expr[]
}

/**
 * An array element access: `feld[i]` (1D) or `feld[spalte, zeile]` (2D). Used both
 * as a value (right-hand side) and as an assignment target (left-hand side). The
 * `indices` array length (1 or 2) tells 1D from 2D (Sprachdef §C).
 */
export interface IndexExpr extends Pos {
  kind: 'IndexExpr'
  /** The array's name (without brackets). */
  name: string
  indices: Expr[]
}

/**
 * A record field access via backslash: `tasche[3]\count` or `p\x`. The base is the
 * record value (an Identifier or an IndexExpr — a record in an array); `field` is the
 * field name. Used as a value and as an assignment target (Sprachdef §C).
 */
export interface FieldExpr extends Pos {
  kind: 'FieldExpr'
  base: Identifier | IndexExpr
  field: string
}

export type Expr =
  | NumberLit
  | StringLit
  | ConstantRef
  | Identifier
  | Unary
  | Binary
  | Grouping
  | CallExpr
  | IndexExpr
  | FieldExpr

// ---- Statements ----

/** A command invocation: `Graphics TEXT`, `DrawText 5, 5, "Hi"`. */
export interface CommandStmt extends Pos {
  kind: 'CommandStmt'
  name: string
  args: Expr[]
}

/** An assignment: `score.w = 10 + 5 * 2`, `feld[s, z] = 1`, or `tasche[3]\count = 5`. */
export interface AssignStmt extends Pos {
  kind: 'AssignStmt'
  target: Identifier | IndexExpr | FieldExpr
  value: Expr
}

/**
 * A global declaration with mandatory init: `Global score.w = 0`. The only way
 * to make a variable live at file scope (Sprachdef §C). The target carries the
 * type suffix like any Identifier; the init is required by the grammar.
 */
export interface GlobalStmt extends Pos {
  kind: 'GlobalStmt'
  target: Identifier
  value: Expr
}

/**
 * A compile-time constant: `Const MAXLIVES = 3`. Free at runtime (Sprachdef §C).
 * Constants have no type suffix — the value's a literal/const expression.
 */
export interface ConstStmt extends Pos {
  kind: 'ConstStmt'
  name: string
  value: Expr
}

/**
 * A fixed-size array declaration: `Dim punkte.b[10]` (1D) or `Dim feld.b[40, 25]`
 * (2D). Sizes are compile-time expressions (literal or Const). The element type
 * comes from the suffix on the name like any variable (Sprachdef §C). 2D is stored
 * as a flat block; the index math lives in CodeGen. (spalte = first dim, zeile = second.)
 */
export interface DimStmt extends Pos {
  kind: 'DimStmt'
  target: Identifier
  /** Dimension sizes: [width] for 1D, [width, height] for 2D. */
  sizes: Expr[]
}

/** One field inside a Type/Field/EndType record: a name + its type suffix. */
export interface FieldDecl {
  name: string
  /** The written type suffix: '.b' | '.w' | '$' (records-in-records: later). */
  suffix?: string
}

/**
 * A record type definition (Sprachdef §C):
 *   Type Slot
 *     Field item.b
 *     Field count.b
 *   EndType
 * Compile-time only — maps to a C `struct`. Instances live in fixed arrays (Dim).
 */
export interface TypeDecl extends Pos {
  kind: 'TypeDecl'
  name: string
  fields: FieldDecl[]
}

/** One `ElseIf <cond>` branch inside an If. */
export interface ElseIfClause {
  cond: Expr
  body: Statement[]
}

/**
 * Branch. Covers both forms: the single-line `If c Then stmt` (then = [stmt],
 * no elifs/else) and the multi-line `If c … ElseIf … Else … EndIf`.
 */
export interface IfStmt extends Pos {
  kind: 'IfStmt'
  cond: Expr
  then: Statement[]
  elifs: ElseIfClause[]
  else?: Statement[]
}

/** Head-controlled loop: `While <cond> … Wend`. */
export interface WhileStmt extends Pos {
  kind: 'WhileStmt'
  cond: Expr
  body: Statement[]
}

/** Foot-controlled loop: `Repeat … Until <cond>`. */
export interface RepeatStmt extends Pos {
  kind: 'RepeatStmt'
  body: Statement[]
  until: Expr
}

/** Counting loop: `For <var> = <from> To <to> [Step <step>] … Next`. */
export interface ForStmt extends Pos {
  kind: 'ForStmt'
  variable: Identifier
  from: Expr
  to: Expr
  step?: Expr
  body: Statement[]
}

/** `Exit` — break out of the innermost loop. */
export interface ExitStmt extends Pos {
  kind: 'ExitStmt'
}

export type Statement =
  | CommandStmt
  | AssignStmt
  | GlobalStmt
  | ConstStmt
  | DimStmt
  | TypeDecl
  | IfStmt
  | WhileStmt
  | RepeatStmt
  | ForStmt
  | ExitStmt

// ---- Program ----

export interface Program {
  kind: 'Program'
  body: Statement[]
}

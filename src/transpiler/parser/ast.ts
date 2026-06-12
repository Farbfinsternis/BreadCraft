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

/** One parameter in a function signature: a name + optional type suffix. A typeless
 *  param (`x`) takes anything (CodeGen reserves .w); a typed one (`x.w`) is checked. */
export interface ParamDecl {
  name: string
  /** Written type suffix: '.b' | '.w' | '$' | undefined (typeless). */
  suffix?: string
}

/**
 * A function definition (Sprachdef §C.1):
 *   Function Distance.w(x1.b, y1.b)   ; return type = suffix on the NAME (.w here)
 *     ... : Return d.w
 *   EndFunction
 * A suffix on the name (.b/.w/$) means it returns a value (call needs parentheses);
 * NO suffix means it's a statement-function (no return value). by-value params,
 * recursion forbidden — both enforced in CodeGen (P1.T3), the parser just records.
 * Top-level only: a Function may not be nested inside another block.
 */
export interface FunctionDecl extends Pos {
  kind: 'FunctionDecl'
  name: string
  /** Return-type suffix on the name; undefined = no return value (statement-function). */
  returnSuffix?: string
  params: ParamDecl[]
  body: Statement[]
}

/** `Return [expr]` — leave the current function. The value is present in a
 *  value-returning function, absent for an early exit / statement-function. */
export interface ReturnStmt extends Pos {
  kind: 'ReturnStmt'
  value?: Expr
}

/**
 * A call to a user-defined statement-function used as a statement: `Heal 5` (no
 * parens, SSOT convention: a function with no return value reads like a command).
 * A value-function call lives in an expression as CallExpr (`d = Distance(a,b)`),
 * parens mandatory. `callee` is the function name as written.
 */
export interface CallStmt extends Pos {
  kind: 'CallStmt'
  callee: string
  args: Expr[]
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
  | FunctionDecl
  | ReturnStmt
  | CallStmt

// ---- Program ----

export interface Program {
  kind: 'Program'
  body: Statement[]
}

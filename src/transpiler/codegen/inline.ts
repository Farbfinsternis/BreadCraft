import type { Program, Statement, FunctionDecl, Expr } from '../parser/ast'
import { recordSuffixName } from './suffix'

/**
 * WHICH FUNCTIONS GET PASTED INTO THEIR CALL SITES — and why it is worth a pass of its own.
 *
 * Measured on a real C64 (2026-07-31, `_intern/blob-inline.c`, 2.304 inputs, all 24 record
 * bytes identical in every variant): Into The Deep's blob loop costs 5.637 instruction
 * cycles as it stands, and 4.601 with the three called bodies pasted in — 18,4 % of the
 * loop, for no change to the language at all. A single call costs about 115 cycles before
 * it does anything: cc65 pushes the argument, jumps, saves its register bank in the
 * prologue, restores it in the epilogue and returns.
 *
 * (The same probe found the other half — three pasted bodies can share ONE record-element
 * pointer, worth another 9 % — but that is a different mechanism and gets its own step.
 * `planRecordPointers` refuses a loop counter on purpose, and rightly so.)
 *
 * WHY THE DECISION LIVES HERE AND NOT IN THE CODEGEN. The perf bar prices a call at
 * `COST.call` per call site. If the codegen removed calls the model still charged for, the
 * bar would drift away from the machine — and a bar that drifts is worse than no bar (B4's
 * whole lesson). So the rule is ONE pure function over the AST, and both sides ask it.
 */

/**
 * Body statements (counted through nesting) a function may have and still be pasted in.
 *
 * ★★★ TWELVE — and it took three attempts and one wrong diagnosis to earn that number.
 * Measured on a real C64 with Into The Deep, `_intern/blob-cost.test.ts`:
 *
 *   |               | calls  | T1: pasted, decls in the block | T3: decls at caller scope |
 *   | blob loop     |  5.676 |  5.677 (a wash)                |  **4.131  (−27,2 %)**     |
 *   | whole frame   | 14.251 | 14.223                         |  **12.493 (−12,3 %)**     |
 *   | share of frame| 28,9 % | 28,9 %                         |  **21,0 %**               |
 *   | program CODE  | 7.962 B|  8.695 B                       |  **9.506 B (+1.544)**     |
 *
 * WHY T1 WAS A WASH, and it is not what it looked like at the time. It looked like a budget
 * problem — "cc65 gives each function a six-byte register bank, the call BUYS it, pasting
 * spends it" — and that reading cost a rule (`touchesRecordArray`, since deleted) that kept
 * record-array functions as calls for a year of project time. Recounted 2026-08-04: main's
 * bank stood EMPTY. The real rule is that **cc65 honours `register` only AT FUNCTION SCOPE**
 * and ignores it inside a nested block without a word — and T1 declared a pasted body's
 * locals inside its own `do { … } while (0)`. See `_intern/regbank.test.ts`.
 *
 * T3 hoists every declaration to the caller's function scope and leaves only assignments at
 * the site, which costs nothing (a C89 initialiser in a block is an assignment on entry
 * anyway). Then the pointers of several bodies in one loop round can share, which is what
 * makes the demand fit the bank — and that is where two thirds of the win lives.
 *
 * Twelve is the measured ceiling: at 8, ITD's `DrawBlob` and `TakeHit` (9 statements each,
 * 40 % of the loop between them) stay calls; above 12 nothing in ITD changes at all.
 */
// The type is written out so the constant does not narrow to a literal: the tests compare
// against 0 to describe both states, and with a literal type flipping this to arm the pass
// turns every one of those comparisons into a typecheck error.
export const INLINE_MAX_STMTS: number = 12

/** How deep a pasted body may itself paste. One level of nesting is a real win (a small
 *  helper inside a small helper); unbounded nesting is how generated code explodes. */
export const INLINE_MAX_DEPTH = 2

/** Statements that make a function unfit to paste — each declares something that belongs
 *  to a scope, not to a body. */
const DECLARING = new Set(['DimStmt', 'GlobalStmt', 'ConstStmt', 'TypeDecl', 'FunctionDecl'])

/** Every statement list a statement owns (so both the counter and the scans below can walk
 *  a whole body without knowing the shapes by heart). */
function childBlocks(s: Statement): Statement[][] {
  if (s.kind === 'IfStmt') return [s.then, ...s.elifs.map((e) => e.body), s.else ?? []]
  if (s.kind === 'WhileStmt' || s.kind === 'RepeatStmt' || s.kind === 'ForStmt') return [s.body]
  return []
}

function countStatements(body: Statement[]): number {
  let n = 0
  for (const s of body) {
    n++
    for (const b of childBlocks(s)) n += countStatements(b)
  }
  return n
}

function hasDeclaration(body: Statement[]): boolean {
  for (const s of body) {
    if (DECLARING.has(s.kind)) return true
    for (const b of childBlocks(s)) if (hasDeclaration(b)) return true
  }
  return false
}

/** Every user-function name this body calls — as a statement or inside an expression. */
export function calleesOf(body: Statement[]): Set<string> {
  const out = new Set<string>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    if (rec.kind === 'CallStmt' && typeof rec.callee === 'string') out.add(rec.callee)
    if (rec.kind === 'CallExpr' && typeof rec.callee === 'string') out.add(rec.callee)
    for (const key of Object.keys(rec)) {
      const v = rec[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  body.forEach(walk)
  return out
}

/** The names that belong to the function itself: its parameters, plus every local it makes
 *  by assigning to a new name (`py.b = …`) or by counting a `For` through one. */
export function ownNames(fn: FunctionDecl): Set<string> {
  const own = new Set<string>(fn.params.map((p) => p.name))
  const collect = (body: Statement[]): void => {
    for (const s of body) {
      if (s.kind === 'AssignStmt' && s.target.kind === 'Identifier') own.add(s.target.name)
      if (s.kind === 'ForStmt') own.add(s.variable.name)
      for (const b of childBlocks(s)) collect(b)
    }
  }
  collect(fn.body)
  return own
}

/** Every plain name mentioned in an expression (identifiers and array/record-array names) —
 *  what a call-site check needs to ask "does this argument name something the body owns?" */
export function identifiersIn(e: Expr): Set<string> {
  const out = new Set<string>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    if ((rec.kind === 'Identifier' || rec.kind === 'IndexExpr') && typeof rec.name === 'string') {
      out.add(rec.name)
    }
    for (const key of Object.keys(rec)) {
      const v = rec[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(e as unknown)
  return out
}

/**
 * Names a body reads or writes that it does NOT declare itself — its globals, constants and
 * arrays. These are the names that decide whether a body may be pasted into a given place:
 * inside the caller's block a free name would suddenly find the CALLER's local of the same
 * name. (The reverse — the pasted body's own local shadowing one of the caller's — is
 * exactly what we want and needs no thought.)
 */
export function freeNames(fn: FunctionDecl): Set<string> {
  const own = ownNames(fn)
  const free = new Set<string>()

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    if (rec.kind === 'Identifier' && typeof rec.name === 'string' && !own.has(rec.name)) {
      free.add(rec.name)
    }
    // An array or record-array read carries its name in a field, not in an Identifier node.
    if (rec.kind === 'IndexExpr' && typeof rec.name === 'string' && !own.has(rec.name)) {
      free.add(rec.name)
    }
    for (const key of Object.keys(rec)) {
      const v = rec[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(fn.body as unknown)
  return free
}

export interface InlinePlan {
  /** Function name → its declaration, for every function fit to be pasted in. */
  readonly fit: Map<string, FunctionDecl>
  /** Free names per fit function, for the call-site collision check. */
  readonly free: Map<string, Set<string>>
}

/**
 * EVERY RING IN THE CALL GRAPH: function name → the ring it sits on, in call order.
 *
 * Two customers, and they want the same fact for opposite reasons:
 *
 *   - the inline pass, because a function on a ring can never be pasted (the paste would
 *     need itself);
 *   - the RECURSION DIAGNOSTIC (Review #1, B-6), because `A → B → A` is a program the 6502
 *     cannot run. cc65 will compile it happily and the machine will walk its stack into the
 *     ground at runtime — which reaches the user as a game that freezes, with nothing to
 *     read. The direct case (`A` calls `A`) has been an honest error for a long time; going
 *     one step round the ring was enough to slip past it.
 *
 * The ring is kept, not just the membership, because a diagnostic that can NAME the way
 * round ("Prüfe ruft Melde, und Melde ruft Prüfe") is one the user can act on, and a bare
 * "recursion is not allowed" on a function that plainly does not call itself is not.
 *
 * Each member maps to the SAME rotated array, so a ring can be reported once instead of once
 * per member: rotated to start at the alphabetically first name, which makes the identity
 * stable no matter which function the walk happened to enter from.
 */
export function callCycles(program: Program): Map<string, string[]> {
  const decls = new Map<string, FunctionDecl>()
  for (const s of program.body) if (s.kind === 'FunctionDecl') decls.set(s.name, s)

  const rings = new Map<string, string[]>()
  const state = new Map<string, 'open' | 'done'>()
  const visit = (name: string, stack: string[]): void => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'open') {
      // Everything from the first sighting of `name` onwards IS the ring.
      const at = stack.indexOf(name)
      if (at < 0) return
      const ring = stack.slice(at)
      // Rotate to a canonical start so every member agrees on one identity.
      let lo = 0
      for (let i = 1; i < ring.length; i++) if (ring[i] < ring[lo]) lo = i
      const canon = [...ring.slice(lo), ...ring.slice(0, lo)]
      for (const m of canon) if (!rings.has(m)) rings.set(m, canon)
      return
    }
    state.set(name, 'open')
    const fn = decls.get(name)
    if (fn) for (const c of calleesOf(fn.body)) visit(c, [...stack, name])
    state.set(name, 'done')
  }
  for (const name of decls.keys()) visit(name, [])
  return rings
}

/**
 * Decide, once per program, which functions are fit to paste. Being "fit" is a property of
 * the function; whether a given CALL is pasted also depends on the site (see the codegen:
 * a name collision, or a position where hoisting statements would change when they run).
 */
export function planInlining(program: Program): InlinePlan {
  const decls = new Map<string, FunctionDecl>()
  for (const s of program.body) if (s.kind === 'FunctionDecl') decls.set(s.name, s)

  // A function in a call CYCLE can never be pasted: the paste would need itself.
  const inCycle = callCycles(program)

  const fit = new Map<string, FunctionDecl>()
  const free = new Map<string, Set<string>>()
  for (const [name, fn] of decls) {
    if (inCycle.has(name)) continue
    if (recordSuffixName(fn.returnSuffix)) continue
    if (fn.params.some((p) => recordSuffixName(p.suffix))) continue
    if (hasDeclaration(fn.body)) continue
    if (countStatements(fn.body) > INLINE_MAX_STMTS) continue
    fit.set(name, fn)
    free.set(name, freeNames(fn))
  }
  return { fit, free }
}

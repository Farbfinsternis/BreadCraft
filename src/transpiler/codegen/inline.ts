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
 * ★★★ ZERO — THE PASS IS OFF, ON PURPOSE, AND THE MEASUREMENT IS WHY (user's decision,
 * 2026-07-31, after seeing these numbers).
 *
 * Built, tested, measured on a real C64 with Into The Deep — and it is a wash:
 *
 *   |                    | before | pasted naively | pasted with the record rule |
 *   | blob loop          |  5.676 |  7.341 (+29 %) |  5.677                      |
 *   | whole frame        | 14.253 | 16.167         | 14.223                      |
 *   | program CODE       | 7.962 B| 10.500 B       |  8.695 B                    |
 *
 * **30 cycles a frame for 733 bytes.** Eight functions were pasted, each running once a frame,
 * so ~920 cycles of call overhead should have gone. It did not, and the reason is the same one
 * that made the first attempt 29 % SLOWER, one floor down: cc65 gives each FUNCTION its own
 * six-byte register bank in the zero page, and a pasted body has to share the caller's, which
 * is already spent. The record-element pointer falls out of it (that is what `touchesRecordArray`
 * now refuses), and so do the body's own 16-bit LOCALS — `nexty`, the acceleration temporaries.
 * On the software stack each of those costs a helper call, and the saving and the loss cancel.
 *
 * So the honest reading: **while cc65 hands out one register bank per function, the call is what
 * BUYS that bank, and pasting spends it.** The 4.094 cycles measured in `_intern/blob-inline.c`
 * (−27 % against 5.637) were never "inlining" — they were inlining with the register demand kept
 * inside ONE bank, which is a budget question, not a call question.
 *
 * Setting this to **12** re-arms everything (that was the measured ceiling: at 8, ITD's
 * `DrawBlob` and `TakeHit` — 9 statements each, 40 % of the loop between them — stayed calls;
 * above 12 nothing in ITD changes at all). Do that when T3 exists: paste on the AST, before the
 * record-pointer pass, and allocate the six bytes deliberately. Until then the machinery sleeps —
 * a feature that costs 733 bytes for 0,15 % should not ship quietly.
 */
export const INLINE_MAX_STMTS = 0

/** How deep a pasted body may itself paste. One level of nesting is a real win (a small
 *  helper inside a small helper); unbounded nesting is how generated code explodes. */
export const INLINE_MAX_DEPTH = 2

/** Statements that make a function unfit to paste — each declares something that belongs
 *  to a scope, not to a body. */
const DECLARING = new Set(['DimStmt', 'GlobalStmt', 'ConstStmt', 'TypeDecl', 'FunctionDecl'])

/**
 * ★★★ THE ONE THAT COST A DAY TO LEARN: A FUNCTION THAT REACHES INTO A RECORD ARRAY IS BETTER
 * OFF BEING CALLED.
 *
 * cc65 gives every FUNCTION its own six-byte register bank in the zero page. That is where
 * S1.B5.T3 puts the pointer to `blobs[idx]`, and it is the biggest single win this project has:
 * one indexed load per field (`lda (regbank+4),y`) instead of working the address out again and
 * again. Measured back then on Into The Deep: 16.859 → 14.500 cycles a frame.
 *
 * A pasted body has no bank of its own. It must share the caller's, and `main`'s is already
 * spent on `main`'s own 16-bit locals — so cc65 quietly puts the pasted body's pointer on the
 * SOFTWARE STACK, and every field access becomes `jsr ldptr10sp` first. Measured on the real
 * machine, ITD's blob loop: **5.676 → 7.341 cycles, 29 % WORSE** — pasting had undone T3. In
 * the generated assembly it is plain to see: `regbank` references 142 → 71, `ldptr10sp` 0 → 18.
 *
 * So the call is not pure overhead here: it BUYS a private zero-page bank, and that is worth
 * more than the ~115 cycles it costs. A function that touches a record-array element keeps its
 * call.
 *
 * This is the narrow, honest rule and not the last word: pasting the bodies and THEN working
 * out one shared pointer for the whole loop was measured at 4.094 cycles — better than either
 * of them. That needs the paste to happen on the AST, before the record-pointer pass runs, and
 * it is written up as T3 in `_intern/INLINE_PLAN.md`.
 */
function touchesRecordArray(body: Statement[]): boolean {
  let found = false
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    if (rec.kind === 'FieldExpr') {
      const base = rec.base as { kind?: string } | undefined
      if (base?.kind === 'IndexExpr') {
        found = true
        return
      }
    }
    for (const key of Object.keys(rec)) {
      const v = rec[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  body.forEach(walk)
  return found
}

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
 * Decide, once per program, which functions are fit to paste. Being "fit" is a property of
 * the function; whether a given CALL is pasted also depends on the site (see the codegen:
 * a name collision, or a position where hoisting statements would change when they run).
 */
export function planInlining(program: Program): InlinePlan {
  const decls = new Map<string, FunctionDecl>()
  for (const s of program.body) if (s.kind === 'FunctionDecl') decls.set(s.name, s)

  // A function in a call CYCLE can never be pasted: the paste would need itself. Direct
  // self-calls are already an error elsewhere; this catches A→B→A.
  const inCycle = new Set<string>()
  const state = new Map<string, 'open' | 'done'>()
  const visit = (name: string, stack: string[]): void => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'open') {
      // Everything from the first sighting of `name` onwards is on the cycle.
      for (let i = stack.indexOf(name); i >= 0 && i < stack.length; i++) inCycle.add(stack[i])
      return
    }
    state.set(name, 'open')
    const fn = decls.get(name)
    if (fn) for (const c of calleesOf(fn.body)) visit(c, [...stack, name])
    state.set(name, 'done')
  }
  for (const name of decls.keys()) visit(name, [])

  const fit = new Map<string, FunctionDecl>()
  const free = new Map<string, Set<string>>()
  for (const [name, fn] of decls) {
    if (inCycle.has(name)) continue
    if (recordSuffixName(fn.returnSuffix)) continue
    if (fn.params.some((p) => recordSuffixName(p.suffix))) continue
    if (hasDeclaration(fn.body)) continue
    if (touchesRecordArray(fn.body)) continue
    if (countStatements(fn.body) > INLINE_MAX_STMTS) continue
    fit.set(name, fn)
    free.set(name, freeNames(fn))
  }
  return { fit, free }
}

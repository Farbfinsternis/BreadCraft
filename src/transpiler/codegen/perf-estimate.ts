import type { Program, Statement, Expr, FunctionDecl, ForStmt, WhileStmt } from '../parser/ast'
import type { PerfInfo } from '@shared/ipc'

// Per-frame CPU-cost ESTIMATE, extrapolated from the .crumb AST — a guess, never a
// runtime measurement (the BASSM approach the user chose). The point is the RELATIVE
// signal: write a multiply or a deep loop and the number climbs; nothing here pretends
// to count exact cycles. (memory: c64-math-cost-model)

// One PAL frame ≈ 312 rasterlines × 63 cycles. Cross it and `VWait` lands on the NEXT
// frame → the game halves to 25 fps. That wall is what the estimate measures against.
const PAL_FRAME_CYCLES = 19656

// Coarse cc65-on-6502 cost guesses. Only the orders of magnitude matter (mul ≫ add,
// a call has overhead, a loop multiplies its body).
const COST = {
  literal: 3,
  name: 7, // read a variable/const
  index: 28, // [i] element addressing
  field: 14, // record field
  assign: 12,
  add: 10, // + - comparisons, And/Or
  shift: 16, // Shl/Shr
  mul: 140, // software multiply — the 6502 has none
  div: 200, // software divide / Mod
  call: 45, // cc65 call convention (push args, jsr, frame)
  ctrl: 6 // a branch / loop test
}

// Rough cost of each built-in's body — the part the user can't see (ON TOP of the one
// COST.call the model already adds per call). Kept in step with codegen by hand.
// TileSolid/TileAt carry the pixel→cell→tile lookup AND a hidden second cc65 call to
// bc_tile_at that the model's single COST.call doesn't see — so their body must carry
// that extra call layer plus the 16-bit pixel math (STAHL S10: re-levelled against the
// measured .s — ~8–9 jsr each, the priciest per-frame reads, near a software multiply).
// After S10's F1 the solid wrapper is gone, so tilesolid ≈ tileat (just a bc_solid[tile]
// table-load on the result more — STAHL S11; an `lda bc_solid,x`, barely above the old `!= 0`).
// GetTile is an inline Screen-RAM index (no call, no 16-bit px) — genuinely the cheaper
// path, which is why it worked as a hand workaround. Setup commands cost ~0 per frame.
const BUILTIN: Record<string, number> = {
  vwait: 0,
  sprite: 50,
  showsprite: 12,
  hidesprite: 12,
  usesprite: 0,
  usetileset: 0,
  drawmap: 0,
  graphics: 0,
  cls: 0,
  bordercolor: 8,
  drawtext: 60,
  settile: 60,
  joystick: 30,
  tilesolid: 122, // hidden bc_tile_at call + 16-bit pixel→cell + bounds + bc_solid[tile] load
  tileat: 115, // same minus the `!= 0`
  gettile: 30, // inline Screen-RAM index — no call, no 16-bit px
  min: 25,
  max: 25,
  abs: 14
}
const DEFAULT_CALL = 25
const LOOP_GUESS = 4 // unknown While/Repeat iteration count → a flat guess

/**
 * Estimate the CPU cost of ONE iteration of the main frame loop (the `While` that
 * contains `VWait`), including the functions it calls. Returns null when there is no
 * frame loop to talk about. A guess, surfaced honestly as the PERF health-bar.
 */
export function estimateFramePerf(program: Program): PerfInfo | null {
  const consts = new Map<string, Expr>()
  const funcs = new Map<string, FunctionDecl>()
  for (const s of program.body) {
    if (s.kind === 'ConstStmt') consts.set(s.name, s.value)
    else if (s.kind === 'FunctionDecl') funcs.set(s.name, s)
  }

  const funcCostCache = new Map<string, number>()
  const computing = new Set<string>()
  function costOfFunc(name: string): number {
    const f = funcs.get(name)
    if (!f) return DEFAULT_CALL
    const cached = funcCostCache.get(name)
    if (cached !== undefined) return cached
    if (computing.has(name)) return 0 // recursion guard (CRUMB forbids it anyway)
    computing.add(name)
    const c = costStmts(f.body)
    computing.delete(name)
    funcCostCache.set(name, c)
    return c
  }

  function constInt(e: Expr | undefined): number | undefined {
    if (!e) return undefined
    switch (e.kind) {
      case 'NumberLit': {
        const radix = e.base === 'hex' ? 16 : e.base === 'bin' ? 2 : 10
        const n = parseInt(e.raw, radix)
        return Number.isNaN(n) ? undefined : n
      }
      case 'Grouping':
        return constInt(e.expr)
      case 'Unary':
        return e.op === '-' ? neg(constInt(e.expr)) : undefined
      case 'Binary': {
        const l = constInt(e.left)
        const r = constInt(e.right)
        if (l === undefined || r === undefined) return undefined
        if (e.op === '+') return l + r
        if (e.op === '-') return l - r
        if (e.op === '*') return l * r
        return undefined
      }
      case 'ConstantRef':
      case 'Identifier':
        return constInt(consts.get(e.name))
      default:
        return undefined
    }
  }
  const neg = (n: number | undefined): number | undefined => (n === undefined ? undefined : -n)

  function calleeCost(name: string): number {
    const builtin = BUILTIN[name.toLowerCase()]
    if (builtin !== undefined) return builtin
    return funcs.has(name) ? costOfFunc(name) : DEFAULT_CALL
  }

  function exprCost(e: Expr): number {
    switch (e.kind) {
      case 'NumberLit':
      case 'StringLit':
        return COST.literal
      case 'ConstantRef':
      case 'Identifier':
        return COST.name
      case 'Grouping':
        return exprCost(e.expr)
      case 'Unary':
        return COST.add + exprCost(e.expr)
      case 'Binary':
        return binOpCost(e.op) + exprCost(e.left) + exprCost(e.right)
      case 'IndexExpr':
        return COST.index + e.indices.reduce((a, x) => a + exprCost(x), 0)
      case 'FieldExpr':
        return COST.field + exprCost(e.base)
      case 'CallExpr':
        return COST.call + calleeCost(e.callee) + e.args.reduce((a, x) => a + exprCost(x), 0)
    }
  }

  function binOpCost(op: string): number {
    const o = op.toLowerCase()
    if (o === '*') return COST.mul
    if (o === '/' || o === 'mod') return COST.div
    if (o === 'shl' || o === 'shr') return COST.shift
    return COST.add
  }

  function costStmts(body: Statement[]): number {
    return body.reduce((a, s) => a + stmtCost(s), 0)
  }

  function forIterations(s: ForStmt): number {
    const from = constInt(s.from)
    const to = constInt(s.to)
    const step = s.step ? (constInt(s.step) ?? 1) : 1
    if (from === undefined || to === undefined || step === 0) return LOOP_GUESS
    const n = Math.floor((to - from) / step) + 1
    return n > 0 ? n : 1
  }

  function stmtCost(s: Statement): number {
    switch (s.kind) {
      case 'CommandStmt':
        return calleeCost(s.name) + s.args.reduce((a, x) => a + exprCost(x), 0)
      case 'CallStmt':
        return COST.call + calleeCost(s.callee) + s.args.reduce((a, x) => a + exprCost(x), 0)
      case 'AssignStmt':
        return COST.assign + exprCost(s.target) + exprCost(s.value)
      case 'GlobalStmt':
        return COST.assign + exprCost(s.value)
      case 'IfStmt': {
        // Worst-case path: the branch that could cost the most ("up to" this much).
        const branches = [
          costStmts(s.then),
          ...s.elifs.map((e) => exprCost(e.cond) + costStmts(e.body)),
          s.else ? costStmts(s.else) : 0
        ]
        return exprCost(s.cond) + Math.max(...branches)
      }
      case 'WhileStmt':
        return LOOP_GUESS * (COST.ctrl + exprCost(s.cond) + costStmts(s.body))
      case 'RepeatStmt':
        return LOOP_GUESS * (COST.ctrl + costStmts(s.body) + exprCost(s.until))
      case 'ForStmt':
        return forIterations(s) * (COST.ctrl + costStmts(s.body))
      case 'ReturnStmt':
        return COST.ctrl + (s.value ? exprCost(s.value) : 0)
      case 'ExitStmt':
        return COST.ctrl
      default:
        return 0 // declarations carry no per-frame runtime cost
    }
  }

  const frame = findFrameLoop(program.body)
  if (!frame) return null
  const cyclesPerFrame = costStmts(frame.body)
  const fraction = cyclesPerFrame / PAL_FRAME_CYCLES
  const state = fraction >= 1 ? 'over' : fraction >= 0.75 ? 'warn' : 'ok'
  return { cyclesPerFrame, budgetCycles: PAL_FRAME_CYCLES, fraction, state }
}

/** The main loop = the first top-level `While` whose body runs `VWait` (the frame sync). */
function findFrameLoop(body: Statement[]): WhileStmt | undefined {
  for (const s of body) {
    if (
      s.kind === 'WhileStmt' &&
      s.body.some((x) => x.kind === 'CommandStmt' && x.name.toLowerCase() === 'vwait')
    ) {
      return s
    }
  }
  return undefined
}

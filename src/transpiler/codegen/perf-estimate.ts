import type { Program, Statement, Expr, FunctionDecl, ForStmt, WhileStmt } from '../parser/ast'
import type { PerfInfo, PerfWorld, Region } from '@shared/ipc'
import { DEFAULT_REGION } from '@shared/ipc'
import type { ColorModel } from '@shared/level-cost'

// Per-frame CPU-cost ESTIMATE, extrapolated from the .crumb AST — a guess, never a
// runtime measurement (the BASSM approach the user chose). The point is the RELATIVE
// signal: write a multiply or a deep loop and the number climbs; nothing here pretends
// to count exact cycles. (memory: c64-math-cost-model)

// The per-frame cycle wall the estimate measures against (STAHL S5c). Cross it and
// `VWait` lands on the NEXT frame → the game halves its rate. NTSC's frame is shorter
// AND its dot-clock faster, so its budget is the TIGHTER one: a game that just fits on
// PAL can overrun on NTSC. The project's region picks which wall the PERF bar holds you to.
//   PAL  ≈ 312 rasterlines × 63 cycles = 19656  (50 Hz)
//   NTSC ≈ 263 rasterlines × 65 cycles = 17095  (60 Hz)
const FRAME_CYCLES: Record<Region, number> = {
  PAL: 19656,
  NTSC: 17095
}

/** Cycles in ONE raster line — the unit the raster split measures a scrolling frame's two
 *  rooms in (S1.B4). PAL's line is 63 cycles, NTSC's 65. */
const LINE_CYCLES: Record<Region, number> = {
  PAL: 63,
  NTSC: 65
}

/** Raster lines one tile row of the band takes to draw. */
const LINES_PER_BAND_ROW = 8

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
 * What the SCROLLING ENGINE costs on top of the user's own code (S1.B4). Unlike the
 * guesses above, these numbers were MEASURED on the finished engine in VICE (CIA2 timer
 * around each block of work, `_intern/SCROLLING_PLAN.md` T4) — so what the bar shows for a
 * scrolling game is hardware truth, not extrapolation.
 *
 * TWO THINGS MAKE A SCROLLING FRAME DIFFERENT, and the bar would lie without either:
 *
 *   1. IT IS NOT AN AVERAGE. `$D016` shifts the picture 0–7 pixels for one register write
 *      (free), and every 8th pixel the band must physically move one column — screen RAM,
 *      Color-RAM (the VIC does not scroll $D800) and the column appearing at the edge.
 *      One heavy frame among eight light ones: 15.886 cycles measured against 4.240 on
 *      average at a ten-row band. An average hides the only frame that can tear.
 *   2. IT IS NOT ONE BUDGET. The shift has to fit below the band (the TAIL, `312 − 8·H`
 *      raster lines) — a taller band grows the work AND shrinks the room it must fit,
 *      which is exactly why H = 12 tore where H = 10 stands, and why the ceiling belongs
 *      to this engine rather than to the machine. And what is left of the frame after the
 *      shift is what the program's own code may cost (the ROOM). See PerfWorld in
 *      @shared/ipc.
 */
const ENGINE = {
  /** Cycles the coarse step costs PER BAND ROW — copy plus revealed column (T4: 13.309
   *  cycles at ten rows, of the ~14.600 the tail then offers). */
  shiftPerBandRow: 1331,
  /** Building the column about to appear (`bc_set_camx`'s loop), per band row. Lands on
   *  the same frame as the shift — the program decides, the tail moves. */
  edgePerBandRow: 90,
  /** …plus its fixed part: clamping, the fine-scroll value, deciding which way to travel. */
  edgeFixed: 60,
  /** Colour per TILE needs a second indexed load per row (tile → colour table) where
   *  colour per CELL reads straight. The cheap RAM model costs a hair of time — the
   *  honest other side of halving the level's bytes. */
  edgeTileTable: 15,
  /** Handing the sprite set to the VIC in the tail (`bc_spr_flush`), per named slot: the
   *  world→screen sum, the window test, two register writes. Every frame. */
  sprFlushPerSlot: 90,
  /** …and the flush's own loop/register overhead. */
  sprFlushFixed: 40,
  /** Frames between two coarse steps at full camera speed: eight pixels to a character. */
  stepEveryFrames: 8,
  /**
   * What the SPLIT ITSELF takes out of EVERY frame, on top of moving the band: two
   * interrupt entries that each wait for their exact raster line, the frame turnover
   * `VWait` waits for, the deadline question before the step — plus the cycles the VIC
   * steals from the CPU while it fetches a row of characters.
   *
   * MEASURED, not derived (SCROLLING_PLAN Schritt 2, T1). The probe raised its own load
   * until a frame failed, backed off and ran clean: at ten band rows it carried 4.965
   * cycles of game code with a column pushed in EVERY frame. 19.656 − 13.310 (the step)
   * − 4.965 = 1.381, and that is this number.
   */
  splitOverhead: 1381
}

/** What the emitted scrolling engine adds to a frame — facts only the codegen knows, so
 *  it hands them over rather than the estimator re-deriving them from the AST (one truth
 *  about the band, memory: breadcraft-ssot-langjson). */
export interface EngineCost {
  /** The program moves the window (`SetCameraX`/`Follow`) → the band physically shifts. */
  usesCamera: boolean
  /** Tile rows that travel (`PlayField`). */
  bandRows: number
  /** Sprite slots the program names (`BC_SPR_N`) — the tail writes their registers. */
  spriteSlots: number
  /** How the baked level carries colour. */
  colorModel: ColorModel
}

/**
 * Estimate the CPU cost of ONE iteration of the main frame loop (the `While` that
 * contains `VWait`), including the functions it calls. Returns null when there is no
 * frame loop to talk about. A guess, surfaced honestly as the PERF health-bar.
 * `region` picks the cycle budget (STAHL S5c); defaults to PAL for callers/old projects.
 * `engine` (S1.B4) adds what the scrolling engine costs underneath the program, and turns
 * the single frame budget into the split frame's two rooms (`world`) — the heavy frame's
 * fuller room is then what the bar is held to. Without it, a frame is a frame.
 */
export function estimateFramePerf(
  program: Program,
  region: Region = DEFAULT_REGION,
  engine?: EngineCost
): PerfInfo | null {
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
  const budgetCycles = FRAME_CYCLES[region]
  const ownCode = costStmts(frame.body)
  const sprTail = spriteTail(engine)
  // The frame's total work, heavy frame included — the "what does this cost" figure.
  const world = worldFrame(ownCode, sprTail, region, engine)
  const cyclesPerFrame = ownCode + sprTail
  // Inside a world the bar is held to the NEARER of the heavy frame's two walls; outside
  // one a frame is a frame (S1.B4).
  const fraction = world
    ? Math.max(world.roomUsed / world.roomCycles, world.tailUsed / world.tailCycles)
    : cyclesPerFrame / budgetCycles
  const state = fraction >= 1 ? 'over' : fraction >= 0.75 ? 'warn' : 'ok'
  return { cyclesPerFrame, budgetCycles, fraction, state, region, ...(world ? { world } : {}) }
}

/** What handing the sprite set to the VIC costs in the tail — every frame, because a
 *  sprite's registers may only be written below the band (S1.B3.3). */
function spriteTail(engine?: EngineCost): number {
  if (!engine || engine.spriteSlots <= 0) return 0
  return ENGINE.sprFlushFixed + engine.spriteSlots * ENGINE.sprFlushPerSlot
}

/**
 * The two walls of a scrolling frame, filled for the HEAVY frame — the one in eight on
 * which the band physically moves a column. A world whose window never travels has no
 * heavy frame (it pays nothing for a move it never makes), but it still runs on the split,
 * so its room is reported all the same.
 *
 * ★ THE TWO WALLS ARE MEASURED DIFFERENTLY, AND HARDWARE SAID SO (Schritt 2, T4).
 *
 *   - THE TAIL is a per-frame deadline: the step either fits below the band or it does
 *     not, and no other frame can help. So the tail is charged WHOLE.
 *   - THE ROOM is elastic. A column is only pushed every 8th pixel, and on the seven light
 *     frames the program may borrow the empty tail — the hardware really does let it, and
 *     `bc_vwait`'s deadline only drops a step when a SINGLE frame runs long. So the room is
 *     charged the step's SHARE, not the whole step.
 *
 * The first cut of this model charged the room the whole step ("the floor a game can count
 * on"), and Into The Deep on a six-row band with one blob then read 117 % — while the
 * machine ran it for 214 frames without dropping a single step. A bar that cries wolf about
 * a game running fine on VICE teaches the user to ignore it, which is worse than no bar.
 * The floor was the wrong number because it describes a camera at eight pixels a frame; a
 * scrolling game moves one or two, and `everyFrames` already says so.
 *
 * Measured against the ported game (all three ran on real hardware, drop counter in
 * `_intern/itd-scroll.test.ts`):
 *
 *   band  blobs  work/frame   steps dropped   this model
 *      6      1      11.566      0 of 214        ~65 %  ok
 *      6      3      19.045    192 of 401        ~99 %  warn   (hardware: stutters)
 *     10      3      17.177    374 of 435       ~106 %  over
 */
function worldFrame(
  ownCode: number,
  sprTail: number,
  region: Region,
  engine?: EngineCost
): PerfWorld | undefined {
  if (!engine || engine.bandRows <= 0) return undefined
  // The tail's deadline: the beam is below the band for everything the band's own drawing
  // time leaves over. This is the wall that derives the ten-row ceiling, and the raster
  // interrupt changed nothing about it.
  const bandDrawn = engine.bandRows * LINES_PER_BAND_ROW * LINE_CYCLES[region]
  const tailCycles = FRAME_CYCLES[region] - bandDrawn
  // The column about to appear is built on the very frame whose tail moves the band — the
  // two always land together, so the heavy frame carries both.
  const perRow =
    ENGINE.edgePerBandRow + (engine.colorModel === 'tileTable' ? ENGINE.edgeTileTable : 0)
  const edgeCycles = engine.usesCamera ? ENGINE.edgeFixed + engine.bandRows * perRow : 0
  const shiftCycles = engine.usesCamera ? engine.bandRows * ENGINE.shiftPerBandRow : 0
  const roomUsed = ownCode + edgeCycles
  const tailUsed = sprTail + shiftCycles
  // …and what is left of the frame after all that is the program's own room. Two things
  // do NOT appear here: the band's drawing time (since Schritt 2 an interrupt writes the
  // two split registers, so the program may think straight through the band) and seven
  // eighths of the step (it only falls on one frame in `everyFrames`, and the program may
  // spend the other seven tails on itself).
  const everyFrames = engine.usesCamera ? ENGINE.stepEveryFrames : 0
  const stepShare = everyFrames > 0 ? Math.round(shiftCycles / everyFrames) : 0
  const roomCycles = Math.max(
    1,
    FRAME_CYCLES[region] - sprTail - stepShare - ENGINE.splitOverhead
  )
  return {
    bandRows: engine.bandRows,
    roomCycles,
    roomUsed,
    tailCycles,
    tailUsed,
    shiftCycles,
    everyFrames,
    wall: tailUsed / tailCycles > roomUsed / roomCycles ? 'tail' : 'room'
  }
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

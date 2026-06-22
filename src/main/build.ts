import { spawn, execFile } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'fs'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '../shared/vocabulary'
import type { Ssot } from '../shared/ssot-types'
import { compile, ramInfo, ramInfoFromMap, ramInfoOverflow } from '../transpiler'
import type { AssetContext } from '../transpiler'
import { cc65Tool, cc65Available } from './toolchain'
import { readSettings } from './settings'
import { resolveLanguage } from './config'
import { buildMessages } from './build-messages'
import { listAssets, readAsset, projectRegion } from './project'
import type { BuildLogLine, BuildResult, RamInfo } from '../shared/ipc'

// Build & Run: the last mile. Compiles the given .crumb source to C, invokes the
// bundled cc65 (cl65) to produce a C64 .prg, then launches it in VICE if a path
// is configured. Everything is reported as structured log lines so the renderer
// console can show honest progress (no faked output).

const vocabulary = buildVocabulary(rawSsot as unknown as Ssot)

function run(tool: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(tool, args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      const out = [stdout, stderr].filter(Boolean).join('\n').trim()
      resolve({ code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0, out })
    })
  })
}

/**
 * Compile `source` to C, build a .prg with the bundled cc65, and (if `runAfterBuild`
 * and a VICE path is configured) launch it in VICE. Output goes to
 * `<projectDir>/build/` (main.c, main.prg). With `runAfterBuild === false` (the plain
 * "Build" button, M4.T2) the VICE step is skipped entirely — it returns at stage
 * 'cc65' WITHOUT `needsVicePath`, so a missing VICE path is not treated as a problem.
 */
export async function buildAndRun(
  source: string,
  projectDir: string,
  runAfterBuild = true
): Promise<BuildResult> {
  const buildDir = join(projectDir, 'build')
  const log: BuildLogLine[] = []
  const add = (level: BuildLogLine['level'], text: string): void => {
    log.push({ level, text })
  }

  // Every console line — diagnostics AND this orchestration around them — follows
  // the IDE's language (STAHL S5b): an English UI must never get a wall of German.
  const locale = resolveLanguage()
  const M = buildMessages(locale)

  // 1) .crumb → C. Hand the transpiler the project's asset bridge so tile/sprite
  // commands can bake real C64 bytes from the .bread (resolved at compile time).
  add('info', M.transpiling)
  const assets: AssetContext = {
    manifest: listAssets(projectDir),
    readFile: (rel: string) => readAsset(projectDir, rel)
  }
  // The project's target region (STAHL S5c) picks the PERF budget the estimate measures
  // against AND the region VICE boots — read from the .bread, never silently PAL.
  const region = projectRegion(projectDir)
  const { code, errors, linkerConfig, mainCeiling, highBase, highCeiling, perf } = compile(
    source,
    vocabulary,
    assets,
    locale,
    region
  )
  // The per-frame cost estimate is valid as soon as the code parsed — feed it to the
  // PERF health-bar on every outcome where we actually compiled something.
  const perfInfo = perf ?? undefined
  for (const e of errors) {
    const level = e.severity === 'warn' ? 'warn' : 'error'
    add(level, `${e.stage} ${e.line}:${e.col}: ${e.message}`)
  }
  // Warnings (e.g. narrowing) are honest hints, not blockers; only real errors stop the build.
  if (errors.some((e) => e.severity === 'error')) {
    add('error', M.transpileFailed)
    return { ok: false, stage: 'compile', log, cCode: code, perf: perfInfo }
  }

  // 2) write C, invoke bundled cl65 → .prg
  if (!cc65Available()) {
    add('error', M.cc65Missing)
    return { ok: false, stage: 'compile', log, cCode: code, perf: perfInfo }
  }
  mkdirSync(buildDir, { recursive: true })
  const cPath = join(buildDir, 'main.c')
  const prgPath = join(buildDir, 'main.prg')
  const mapPath = join(buildDir, 'main.map')
  writeFileSync(cPath, code, 'utf8')
  add('info', M.cWritten(cPath))

  // The project-aware linker config reserves the VIC island ($3000/$3800) only when
  // used, so a growing game can't silently overwrite itself (STAHL S1). Addresses here
  // match the ones baked into the C — both come from the same memory-map plan.
  const cfgPath = join(buildDir, 'breadcraft.cfg')
  writeFileSync(cfgPath, linkerConfig, 'utf8')

  // `-m main.map` emits the ld65 segment map so the RAM bar can measure the bytes that
  // actually consume the MAIN budget (B1.T1) — not the .prg size, which over-counts once
  // assets load at a fixed high address with a gap below them (B1.T2+).
  add('cmd', 'cl65 -t c64 -C breadcraft.cfg -O -m main.map main.c -o main.prg')
  const cc = await run(cc65Tool('cl65'), ['-t', 'c64', '-C', 'breadcraft.cfg', '-O', '-m', 'main.map', 'main.c', '-o', 'main.prg'], buildDir)
  if (cc.out) add(cc.code === 0 ? 'info' : 'error', cc.out)
  if (cc.code !== 0 || !existsSync(prgPath)) {
    // A memory-area overflow is the honest STAHL-S1 wall: the program (with its baked
    // assets) outgrew the space below the reserved VIC island. Translate the raw ld65
    // line into a clear message and show the bar pinned over the ceiling.
    const overflow = /overflows memory area (\S+) by (\d+) bytes/i.exec(cc.out)
    if (overflow) {
      const area = overflow[1]
      const over = Number(overflow[2])
      add('error', M.tooLarge(over))
      // Pin the bar for the pool that ACTUALLY overflowed (B1.T5): "HIGH" = the big-arrays
      // pool, anything else = the low code/data pool. Blaming the low pool for a HIGH
      // overflow pointed the user at the wrong fix.
      const ram = ramInfoOverflow(area, over, mainCeiling, highBase, highCeiling)
      return { ok: false, stage: 'cc65', log, cCode: code, ram, perf: perfInfo }
    }
    add('error', M.cc65Failed)
    return { ok: false, stage: 'cc65', log, cCode: code, perf: perfInfo }
  }
  add('ok', M.buildOk(prgPath))

  // RAM health (STAHL S1c, honest measure B1.T1): read the ld65 segment map and count
  // the bytes that consume the MAIN budget. Fall back to the .prg size if the map is
  // missing/unreadable (older toolchain, IO hiccup) — correct while the image is gapless.
  let ram: RamInfo
  try {
    ram = ramInfoFromMap(readFileSync(mapPath, 'utf8'), mainCeiling, highBase, highCeiling)
  } catch {
    ram = ramInfo(statSync(prgPath).size, mainCeiling)
  }
  add(
    ram.state === 'ok' ? 'info' : 'warn',
    M.ramLine(ram.usedBytes, ram.budgetBytes, mainCeiling.toString(16).toUpperCase())
  )
  // The high BSS pool (big arrays) walls independently of code/data — log it on its own
  // line so the console echoes both bars (B1.T5).
  if (ram.high) {
    add(
      ram.high.state === 'ok' ? 'info' : 'warn',
      M.ramLine(ram.high.usedBytes, ram.high.budgetBytes, highCeiling.toString(16).toUpperCase())
    )
  }

  // 3) run in VICE — unless this was a plain Build (no run requested). Skipping is a
  // clean success at stage 'cc65', NOT a needsVicePath case (don't nudge Settings).
  if (!runAfterBuild) {
    add('info', M.buildOnlySkipped)
    return { ok: true, stage: 'cc65', log, cCode: code, prgPath, ram, perf: perfInfo }
  }

  const vicePath = readSettings().vicePath
  if (!vicePath || !existsSync(vicePath)) {
    add('info', M.noVicePath)
    return { ok: true, stage: 'cc65', log, cCode: code, prgPath, needsVicePath: true, ram, perf: perfInfo }
  }

  // Boot VICE in the project's region (STAHL S5c) — `-pal`/`-ntsc` so what the user sees
  // running matches the standard the PERF budget was measured against, not VICE's own default.
  const regionFlag = region === 'NTSC' ? '-ntsc' : '-pal'
  add('cmd', M.startingVice(vicePath, prgPath))
  try {
    const child = spawn(vicePath, [regionFlag, prgPath], { detached: true, stdio: 'ignore' })
    child.unref()
    add('ok', M.viceStarted)
    return { ok: true, stage: 'run', log, cCode: code, prgPath, ram, perf: perfInfo }
  } catch (e) {
    add('error', M.viceStartFailed(String((e as Error).message ?? e)))
    return { ok: false, stage: 'run', log, cCode: code, prgPath, ram, perf: perfInfo }
  }
}

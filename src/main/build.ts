import { spawn, execFile } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '../shared/vocabulary'
import type { Ssot } from '../shared/ssot-types'
import { compile, ramInfo } from '../transpiler'
import type { AssetContext } from '../transpiler'
import { cc65Tool, cc65Available } from './toolchain'
import { readSettings } from './settings'
import { listAssets, readAsset } from './project'
import type { BuildLogLine, BuildResult } from '../shared/ipc'

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
 * Compile `source` to C, build a .prg with the bundled cc65, and (if configured)
 * launch it in VICE. Output goes to `<projectDir>/build/` (main.c, main.prg).
 */
export async function buildAndRun(source: string, projectDir: string): Promise<BuildResult> {
  const buildDir = join(projectDir, 'build')
  const log: BuildLogLine[] = []
  const add = (level: BuildLogLine['level'], text: string): void => {
    log.push({ level, text })
  }

  // 1) .crumb → C. Hand the transpiler the project's asset bridge so tile/sprite
  // commands can bake real C64 bytes from the .bread (resolved at compile time).
  add('info', 'Transpiliere .crumb → C …')
  const assets: AssetContext = {
    manifest: listAssets(projectDir),
    readFile: (rel: string) => readAsset(projectDir, rel)
  }
  const { code, errors, linkerConfig, mainCeiling } = compile(source, vocabulary, assets)
  for (const e of errors) {
    const level = e.severity === 'warn' ? 'warn' : 'error'
    add(level, `${e.stage} ${e.line}:${e.col}: ${e.message}`)
  }
  // Warnings (e.g. narrowing) are honest hints, not blockers; only real errors stop the build.
  if (errors.some((e) => e.severity === 'error')) {
    add('error', 'Transpilieren fehlgeschlagen.')
    return { ok: false, stage: 'compile', log, cCode: code }
  }

  // 2) write C, invoke bundled cl65 → .prg
  if (!cc65Available()) {
    add('error', 'Gebündelter cc65 nicht gefunden (resources/cc65/bin/cl65).')
    return { ok: false, stage: 'compile', log, cCode: code }
  }
  mkdirSync(buildDir, { recursive: true })
  const cPath = join(buildDir, 'main.c')
  const prgPath = join(buildDir, 'main.prg')
  writeFileSync(cPath, code, 'utf8')
  add('info', `C geschrieben: ${cPath}`)

  // The project-aware linker config reserves the VIC island ($3000/$3800) only when
  // used, so a growing game can't silently overwrite itself (STAHL S1). Addresses here
  // match the ones baked into the C — both come from the same memory-map plan.
  const cfgPath = join(buildDir, 'breadcraft.cfg')
  writeFileSync(cfgPath, linkerConfig, 'utf8')

  add('cmd', 'cl65 -t c64 -C breadcraft.cfg -O main.c -o main.prg')
  const cc = await run(cc65Tool('cl65'), ['-t', 'c64', '-C', 'breadcraft.cfg', '-O', 'main.c', '-o', 'main.prg'], buildDir)
  if (cc.out) add(cc.code === 0 ? 'info' : 'error', cc.out)
  if (cc.code !== 0 || !existsSync(prgPath)) {
    // A memory-area overflow is the honest STAHL-S1 wall: the program (with its baked
    // assets) outgrew the space below the reserved VIC island. Translate the raw ld65
    // line into a clear message and show the bar pinned over the ceiling.
    const overflow = /overflows memory area \S+ by (\d+) bytes/i.exec(cc.out)
    if (overflow) {
      const over = Number(overflow[1])
      add('error', `Zu groß für den Speicher: dein Programm überschreitet den nutzbaren Bereich um ${over} Bytes. Mach den Code/die Assets kleiner — oder die Health-Bar zeigt, wie nah du an der Grenze bist.`)
      // Feed a synthetic .prg size so usedBytes = budget + overflow → state 'over'.
      return { ok: false, stage: 'cc65', log, cCode: code, ram: ramInfo(mainCeiling - 0x0801 + over + 2, mainCeiling) }
    }
    add('error', 'cc65-Build fehlgeschlagen.')
    return { ok: false, stage: 'cc65', log, cCode: code }
  }
  add('ok', `Build erfolgreich → ${prgPath}`)

  // RAM health (STAHL S1c): in the S1a layout the .prg is one contiguous image from
  // $0801, so its size IS the bytes used — measured against the planned ceiling.
  const ram = ramInfo(statSync(prgPath).size, mainCeiling)
  add(
    ram.state === 'ok' ? 'info' : 'warn',
    `RAM: ${ram.usedBytes} von ${ram.budgetBytes} Bytes belegt (bis $${mainCeiling.toString(16).toUpperCase()})`
  )

  // 3) run in VICE if a path is set
  const vicePath = readSettings().vicePath
  if (!vicePath || !existsSync(vicePath)) {
    add('info', 'Kein gültiger VICE-Pfad gesetzt — .prg gebaut, aber nicht gestartet.')
    return { ok: true, stage: 'cc65', log, cCode: code, prgPath, needsVicePath: true, ram }
  }

  add('cmd', `Starte VICE: ${vicePath} "${prgPath}"`)
  try {
    const child = spawn(vicePath, [prgPath], { detached: true, stdio: 'ignore' })
    child.unref()
    add('ok', 'VICE gestartet.')
    return { ok: true, stage: 'run', log, cCode: code, prgPath, ram }
  } catch (e) {
    add('error', `VICE-Start fehlgeschlagen: ${String((e as Error).message ?? e)}`)
    return { ok: false, stage: 'run', log, cCode: code, prgPath, ram }
  }
}

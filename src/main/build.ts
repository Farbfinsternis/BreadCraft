import { spawn, execFile } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import rawSsot from '@shared/breadcraft.lang.json'
import { buildVocabulary } from '../shared/vocabulary'
import type { Ssot } from '../shared/ssot-types'
import { compile } from '../transpiler'
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
  const { code, errors } = compile(source, vocabulary, assets)
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

  add('cmd', 'cl65 -t c64 -O main.c -o main.prg')
  const cc = await run(cc65Tool('cl65'), ['-t', 'c64', '-O', 'main.c', '-o', 'main.prg'], buildDir)
  if (cc.out) add(cc.code === 0 ? 'info' : 'error', cc.out)
  if (cc.code !== 0 || !existsSync(prgPath)) {
    add('error', 'cc65-Build fehlgeschlagen.')
    return { ok: false, stage: 'cc65', log, cCode: code }
  }
  add('ok', `Build erfolgreich → ${prgPath}`)

  // 3) run in VICE if a path is set
  const vicePath = readSettings().vicePath
  if (!vicePath || !existsSync(vicePath)) {
    add('info', 'Kein gültiger VICE-Pfad gesetzt — .prg gebaut, aber nicht gestartet.')
    return { ok: true, stage: 'cc65', log, cCode: code, prgPath, needsVicePath: true }
  }

  add('cmd', `Starte VICE: ${vicePath} "${prgPath}"`)
  try {
    const child = spawn(vicePath, [prgPath], { detached: true, stdio: 'ignore' })
    child.unref()
    add('ok', 'VICE gestartet.')
    return { ok: true, stage: 'run', log, cCode: code, prgPath }
  } catch (e) {
    add('error', `VICE-Start fehlgeschlagen: ${String((e as Error).message ?? e)}`)
    return { ok: false, stage: 'run', log, cCode: code, prgPath }
  }
}

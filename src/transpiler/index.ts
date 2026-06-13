import type { VocabItem } from '@shared/ssot-types'
import type { PerfInfo, Locale } from '@shared/ipc'
import { tokenize } from './lexer'
import { parse } from './parser'
import { generate } from './codegen'
import { estimateFramePerf } from './codegen/perf-estimate'
import { DEFAULT_LOCALE } from './messages'
import type { AssetContext } from './codegen'

// The transpiler's front door: .crumb source → cc65-C, in one call. Runs the
// whole pipeline (lex → parse → generate) and gathers errors from every stage
// with a `stage` tag so the caller (the build service) can report precisely.

export type CompileStage = 'parse' | 'codegen'

export type Severity = 'error' | 'warn'

export interface CompileError {
  stage: CompileStage
  /** error = blocks a correct build; warn = honest hint (e.g. narrowing). */
  severity: Severity
  message: string
  line: number
  col: number
}

export interface CompileResult {
  code: string
  errors: CompileError[]
  /** ld65 linker config matching this project's planned memory map (STAHL S1) —
   *  reserves the VIC island ($3000 charset / $3800 sprites) only when used, so a
   *  growing game can't silently overwrite itself. Pass to cl65 via -C. */
  linkerConfig: string
  /** The address the program image must stay below (the RAM health-bar ceiling, S1c). */
  mainCeiling: number
  /** Estimated per-frame CPU cost (a guess from the code) for the PERF health-bar, or
   *  null when the program has no frame loop to talk about. */
  perf: PerfInfo | null
}

/** Compile .crumb source to cc65-C using the given SSOT vocabulary. `assets` lets
 *  tile/sprite commands bake real C64 bytes from the project's .bread (optional —
 *  without it those commands report an honest "no project" error). `locale` localizes
 *  compiler diagnostics (STAHL S5b); defaults to German (the parser stage is localized
 *  so far — lexer/codegen still emit German until the follow-up S5b blocks). */
export function compile(
  source: string,
  vocabulary: VocabItem[],
  assets?: AssetContext,
  locale: Locale = DEFAULT_LOCALE
): CompileResult {
  const tokens = tokenize(source, vocabulary, locale)
  const { program, errors: parseErrors } = parse(tokens, vocabulary, locale)
  const { code, errors: codegenErrors, linkerConfig, mainCeiling } = generate(program, assets, locale)

  const errors: CompileError[] = [
    ...parseErrors.map((e) => ({ stage: 'parse' as const, severity: 'error' as const, ...e })),
    ...codegenErrors.map((e) => ({ stage: 'codegen' as const, ...e }))
  ]
  return { code, errors, linkerConfig, mainCeiling, perf: estimateFramePerf(program) }
}

export { tokenize } from './lexer'
export { parse } from './parser'
export { generate } from './codegen'
export type { AssetContext } from './codegen'
export { ramInfo } from './codegen/memory-map'

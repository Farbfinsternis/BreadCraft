import type { VocabItem } from '@shared/ssot-types'
import type { PerfInfo, Locale, Region } from '@shared/ipc'
import { DEFAULT_REGION } from '@shared/ipc'
import { tokenize } from './lexer'
import { parse } from './parser'
import { generate } from './codegen'
import { estimateFramePerf } from './codegen/perf-estimate'
import { DEFAULT_LOCALE } from './messages'
import { resolveIncludes, type SourceReader } from './resolve-includes'
import type { AssetContext } from './codegen'

// The transpiler's front door: .crumb source → cc65-C, in one call. Runs the
// whole pipeline (resolve Includes → lex → parse → generate) and gathers errors from
// every stage with a `stage` tag so the caller (the build service) can report precisely.

export type CompileStage = 'include' | 'parse' | 'codegen'

export type Severity = 'error' | 'warn'

export interface CompileError {
  stage: CompileStage
  /** error = blocks a correct build; warn = honest hint (e.g. narrowing). */
  severity: Severity
  message: string
  line: number
  col: number
  /** Which source file the error is in (B3 Include). Absent when `compile` was called
   *  without an entry file name (single-file compile); with `Include`, the diagnostic
   *  points at the right file, not the main one (memory: breadcraft-ux-railing). */
  file?: string
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
  /** Base of the high BSS pool (big arrays above the graphics bank), or null when RAM is
   *  one pool — the second RAM bar measures against this (B1.T5). */
  highBase: number | null
  /** Top of the high BSS pool ($C800). */
  highCeiling: number
  /** Estimated per-frame CPU cost (a guess from the code) for the PERF health-bar, or
   *  null when the program has no frame loop to talk about. */
  perf: PerfInfo | null
}

/** Compile .crumb source to cc65-C using the given SSOT vocabulary. `assets` lets
 *  tile/sprite commands bake real C64 bytes from the project's .bread (optional —
 *  without it those commands report an honest "no project" error). `locale` localizes
 *  compiler diagnostics (STAHL S5b); defaults to German (the parser stage is localized
 *  so far — lexer/codegen still emit German until the follow-up S5b blocks). `entryName`
 *  (B3.T1) stamps the source file name onto every token so diagnostics can name their
 *  file; omit it for a nameless single-file compile (byte-identical to before).
 *  `readSource` (B3.T3) turns on `Include`: given a project-root reader AND an
 *  `entryName`, the front door resolves the include chain into one token stream BEFORE
 *  parsing; without it, `Include` is not available and the source compiles as-is. */
export function compile(
  source: string,
  vocabulary: VocabItem[],
  assets?: AssetContext,
  locale: Locale = DEFAULT_LOCALE,
  region: Region = DEFAULT_REGION,
  entryName?: string,
  readSource?: SourceReader
): CompileResult {
  // Include resolution only runs with a reader AND an entry name (the real project
  // build). Without both, we tokenize the single source directly — byte-identical to
  // before, and a stray `Include` then surfaces as an honest parse error.
  const includeErrors: CompileError[] = []
  let tokens
  if (readSource && entryName !== undefined) {
    const resolved = resolveIncludes(source, entryName, readSource, vocabulary, locale)
    tokens = resolved.tokens
    for (const e of resolved.errors) {
      includeErrors.push({ stage: 'include', severity: 'error', ...e })
    }
  } else {
    tokens = tokenize(source, vocabulary, locale, entryName)
  }
  const { program, errors: parseErrors } = parse(tokens, vocabulary, locale)
  const { code, errors: codegenErrors, linkerConfig, mainCeiling, highBase, highCeiling } = generate(
    program,
    assets,
    locale
  )

  const errors: CompileError[] = [
    ...includeErrors,
    ...parseErrors.map((e) => ({ stage: 'parse' as const, severity: 'error' as const, ...e })),
    ...codegenErrors.map((e) => ({ stage: 'codegen' as const, ...e }))
  ]
  return {
    code,
    errors,
    linkerConfig,
    mainCeiling,
    highBase,
    highCeiling,
    perf: estimateFramePerf(program, region)
  }
}

export { tokenize } from './lexer'
export { parse } from './parser'
export { generate } from './codegen'
export type { AssetContext } from './codegen'
export { ramInfo, ramInfoFromMap, ramInfoOverflow, parseMapSegments } from './codegen/memory-map'
export type { MapSegment } from './codegen/memory-map'
export { resolveIncludes } from './resolve-includes'
export type { SourceReader, IncludeError, ResolveResult } from './resolve-includes'

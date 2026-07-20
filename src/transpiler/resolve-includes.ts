import type { VocabItem } from '@shared/ssot-types'
import type { Locale } from '@shared/ipc'
import type { Token } from './lexer/token'
import { TokenType } from './lexer/token'
import { tokenize, buildClassifier } from './lexer'
import { messages, DEFAULT_LOCALE, type IncludeMessages } from './messages'
import type { Pos } from './parser/ast'

// B3.T2 — the Include resolver. Turns an entry .crumb file plus its `Include "…"`
// lines into ONE merged token stream, each token still carrying the file it came from
// (B3.T1 provenance). CRUMB has a flat global namespace, so an include is a pure
// TEXT insertion — but we mix TOKEN streams (architecture B), not raw source, so a
// diagnostic points at {file,line,col} with no line-map back-math
// (memory: breadcraft-ux-railing, breadcraft-dialect-philosophy).
//
// Pure + injectable: the only I/O is the caller-supplied `readSource`, mirroring the
// asset-resolver's injected reader (asset-resolver.ts) — so this whole module is
// Vitest-testable without a real filesystem. NO codegen, NO parsing here: the resolver
// only recognizes `Include "…"` at a statement start and splices.

/** Reads a project-root-relative `.crumb` path, or null when it doesn't exist. Mirrors
 *  the asset-resolver's `AssetReader`; the build service (B3.T3) injects a real fs reader
 *  rooted at the project directory. */
export type SourceReader = (path: string) => string | null

/** An include-stage diagnostic — same {file,line,col} shape as ParseError/CodeGenError,
 *  so `compile()` (B3.T3) can fold these in with the other stages. */
export interface IncludeError extends Pos {
  message: string
}

export interface ResolveResult {
  /** The merged token stream, ending in exactly one EOF (ready for the parser). */
  tokens: Token[]
  /** Include-stage errors (missing file, cycle, escape, misuse). Empty on success. */
  errors: IncludeError[]
}

// The block openers whose closer is MANDATORY today — so a depth counter over them can
// never get stuck open, which means it never wrongly rejects a valid top-level Include
// (no false positives). `If` is deliberately absent: its inline form (`If x Then y`)
// carries no `EndIf`, and telling inline from block apart pre-parse would need real
// expression parsing; a misread there would reject a legal Include. An Include buried
// in a top-level `If` block is pathological and still fails downstream — we trade that
// rare clean error for zero false positives on the common case.
const BLOCK_OPENERS = new Set(['Function', 'While', 'Repeat', 'For', 'Type'])
const BLOCK_CLOSERS = new Set(['EndFunction', 'Wend', 'Until', 'Next', 'EndType'])

const INCLUDE_KW = 'Include'
const CRUMB_EXT = '.crumb'

/** Normalize a path to a canonical key: forward slashes, no `.`/empty segments. Returns
 *  an error tag for an absolute path or a `..` escape — the two ways out of the project. */
function canonicalize(raw: string): { path: string } | { error: 'escape' | 'absolute' | 'empty' } {
  const norm = raw.replace(/\\/g, '/').trim()
  if (norm === '') return { error: 'empty' }
  // Leading '/' or a Windows drive letter ('C:') means "not project-relative".
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return { error: 'absolute' }
  const parts: string[] = []
  for (const seg of norm.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return { error: 'escape' }
    parts.push(seg)
  }
  if (parts.length === 0) return { error: 'empty' }
  return { path: parts.join('/') }
}

/** The canonical key of a file name already carrying its extension (the entry file, and
 *  every resolved target). Just slash-normalized so `main.crumb` and `main.crumb` match. */
function keyOf(nameWithExt: string): string {
  return nameWithExt.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Resolve `Include` directives starting from `entrySource` (named `entryName`, e.g.
 * `main.crumb`) into one merged, provenance-carrying token stream.
 *
 * - **Include-once**: each target file is spliced at most once (by canonical path).
 * - **Cycles** (`a` includes `b` includes `a`) are an honest error naming the chain.
 * - Paths are **project-root-relative, as written**, with `.crumb` appended; `..` and
 *   absolute paths are rejected.
 * - `Include` is only valid at the **top level** (not inside a function/block).
 */
export function resolveIncludes(
  entrySource: string,
  entryName: string,
  readSource: SourceReader,
  vocabulary: VocabItem[],
  locale: Locale = DEFAULT_LOCALE
): ResolveResult {
  const classifier = buildClassifier(vocabulary)
  const M: IncludeMessages = messages(locale).include
  const out: Token[] = []
  const errors: IncludeError[] = []
  const visited = new Set<string>()

  const isKeyword = (t: Token, name: string): boolean =>
    t.type === TokenType.Word && t.value === name && classifier.get(name) === TokenType.Keyword

  /** Index of the next statement-end token (Newline / ':' / EOF) at or after `from`. */
  const stmtEnd = (toks: Token[], from: number): number => {
    let j = from
    while (j < toks.length) {
      const ty = toks[j].type
      if (ty === TokenType.Newline || ty === TokenType.StatementSep || ty === TokenType.EOF) return j
      j++
    }
    return toks.length
  }

  const push = (t: Token): void => {
    out.push(t)
  }

  // A synthetic newline stamped with a file — guarantees a statement boundary after a
  // spliced file whose last line had no trailing newline.
  const synthNewline = (file: string): Token => ({
    type: TokenType.Newline,
    value: '\n',
    line: 1,
    col: 1,
    length: 1,
    file
  })

  function resolveFile(source: string, fileKey: string, stack: string[]): void {
    const toks = tokenize(source, vocabulary, locale, fileKey)
    let i = 0
    let atStmtStart = true
    let depth = 0

    while (i < toks.length) {
      const t = toks[i]
      if (t.type === TokenType.EOF) break // each file's EOF is dropped; one is added at the very end

      // An Include directive: only recognized at a statement start.
      if (atStmtStart && isKeyword(t, INCLUDE_KW)) {
        const term = handleInclude(toks, i, fileKey, depth, stack)
        i = term // continue at the statement-end token (emitted normally below next loop)
        atStmtStart = true
        continue
      }

      // Track block depth over mandatory-closer blocks (see BLOCK_OPENERS note).
      if (atStmtStart && t.type === TokenType.Word) {
        if (BLOCK_OPENERS.has(t.value) && classifier.get(t.value) === TokenType.Keyword) depth++
        else if (BLOCK_CLOSERS.has(t.value) && classifier.get(t.value) === TokenType.Keyword)
          depth = Math.max(0, depth - 1)
      }

      push(t)
      atStmtStart = t.type === TokenType.Newline || t.type === TokenType.StatementSep
      i++
    }
  }

  /**
   * Handle an `Include` at `toks[i]`. Splices the resolved target (or records an error)
   * and returns the index of the directive's statement-end token, so the caller resumes
   * there. Never throws.
   */
  function handleInclude(
    toks: Token[],
    i: number,
    fileKey: string,
    depth: number,
    stack: string[]
  ): number {
    const kw = toks[i]
    const term = stmtEnd(toks, i + 1)
    const bail = (err: Omit<IncludeError, 'line' | 'col' | 'file'>, at: Token): number => {
      errors.push({ message: err.message, line: at.line, col: at.col, file: at.file })
      return term
    }

    const strTok = toks[i + 1]
    if (!strTok || strTok.type !== TokenType.String) {
      return bail({ message: M.includeNeedsPath() }, kw)
    }
    // Between the string and the statement end, only a trailing comment is allowed.
    for (let j = i + 2; j < term; j++) {
      if (toks[j].type !== TokenType.Comment) return bail({ message: M.includeExtraTokens() }, toks[j])
    }

    if (depth > 0) return bail({ message: M.includeNotTopLevel() }, kw)

    const canon = canonicalize(strTok.value)
    if ('error' in canon) {
      const msg =
        canon.error === 'escape'
          ? M.includeEscape(strTok.value)
          : canon.error === 'absolute'
            ? M.includeAbsolute(strTok.value)
            : M.includeEmpty()
      return bail({ message: msg }, strTok)
    }

    const targetKey = canon.path + CRUMB_EXT

    if (stack.includes(targetKey)) {
      return bail({ message: M.includeCycle([...stack, targetKey].join(' → ')) }, strTok)
    }
    if (visited.has(targetKey)) return term // include-once: already spliced, silently skip

    visited.add(targetKey)
    const src = readSource(targetKey)
    if (src === null) {
      const from = `${fileKey}:${kw.line}`
      return bail({ message: M.includeMissing(targetKey, from) }, strTok)
    }

    resolveFile(src, targetKey, [...stack, targetKey])
    push(synthNewline(targetKey)) // guarantee a boundary after the spliced file
    return term
  }

  const entryKey = keyOf(entryName)
  resolveFile(entrySource, entryKey, [entryKey])
  out.push({ type: TokenType.EOF, value: '', line: 1, col: 1, length: 0, file: entryKey })
  return { tokens: out, errors }
}

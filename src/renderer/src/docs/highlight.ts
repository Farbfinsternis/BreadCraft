import * as monaco from 'monaco-editor'
import {
  CRUMB_LANGUAGE_ID,
  CRUMB_TOKEN_COLORS,
  registerCrumb,
  registerTheme
} from '@renderer/monaco/crumb'
import { useLanguageStore } from '@renderer/stores/language'

/**
 * CRUMB syntax highlighting for documentation code blocks (DOKU sprint, D4).
 *
 * It reuses the EXACT same Monarch tokenizer the editor uses (monaco.editor.tokenize)
 * fed from the SSOT vocabulary — one lexical truth, no second highlighter to drift
 * (memory: breadcraft-tokenizer-ssot). Token colours come from the shared
 * CRUMB_TOKEN_COLORS table, so a code block in the docs matches the editor.
 *
 * Everything is defensive: if Monaco or the vocabulary isn't ready yet, it degrades
 * to plain escaped code (exactly the D1 look) rather than throwing.
 */

const COLOR: Record<string, string> = Object.fromEntries(
  CRUMB_TOKEN_COLORS.map((c) => [c.token, `#${c.foreground}`])
)

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string
  )
}

/** Resolve a Monaco token type ('number.hex.crumb') to a colour, most-specific first. */
function colorFor(type: string): string | undefined {
  const parts = type.split('.').filter((p) => p && p !== CRUMB_LANGUAGE_ID)
  while (parts.length) {
    const hit = COLOR[parts.join('.')]
    if (hit) return hit
    parts.pop()
  }
  return undefined
}

let registered = false
function ensureRegistered(): void {
  if (registered) return
  // The vocabulary store is loaded at app start; pull the current vocabulary so the
  // tokenizer classifies the same words the editor does. Idempotent re-registration.
  const vocab = useLanguageStore().vocabulary
  registerCrumb(vocab)
  registerTheme()
  registered = true
}

function renderLine(line: string, tokens: monaco.Token[]): string {
  if (!tokens.length) return escapeHtml(line)
  let html = ''
  for (let k = 0; k < tokens.length; k++) {
    const start = tokens[k].offset
    const end = k + 1 < tokens.length ? tokens[k + 1].offset : line.length
    const text = line.slice(start, end)
    if (!text) continue
    const color = colorFor(tokens[k].type)
    html += color ? `<span style="color:${color}">${escapeHtml(text)}</span>` : escapeHtml(text)
  }
  return html
}

/** Highlight a CRUMB snippet → HTML span markup (safe; text is escaped). */
export function highlightCrumb(code: string): string {
  try {
    ensureRegistered()
    const lines = monaco.editor.tokenize(code, CRUMB_LANGUAGE_ID)
    return code
      .split('\n')
      .map((line, i) => renderLine(line, lines[i] ?? []))
      .join('\n')
  } catch {
    return escapeHtml(code) // graceful fallback: plain code block (the D1 look)
  }
}

import * as monaco from 'monaco-editor'
import type { VocabItem } from '@renderer/language/ssot'

export const CRUMB_LANGUAGE_ID = 'crumb'
export const BREADCRAFT_THEME_ID = 'breadcraft-dark'

let languageRegistered = false

/**
 * Register (or re-register) the .crumb tokenizer, fed ENTIRELY from the SSOT
 * vocabulary — a name is only highlighted if it exists in breadcraft.lang.json.
 * Unknown words (including invented commands/functions) stay plain `identifier`.
 */
export function registerCrumb(vocabulary: VocabItem[]): void {
  // The language id is registered once; the tokenizer can be re-set (e.g. when
  // the vocabulary loads/changes) without re-registering the language.
  if (!languageRegistered) {
    monaco.languages.register({ id: CRUMB_LANGUAGE_ID, extensions: ['.crumb'] })
    monaco.languages.setLanguageConfiguration(CRUMB_LANGUAGE_ID, languageConfiguration)
    languageRegistered = true
  }

  const names = (kinds: VocabItem['kind'][]): string[] =>
    vocabulary.filter((v) => kinds.includes(v.kind)).map((v) => v.name)

  monaco.languages.setMonarchTokensProvider(CRUMB_LANGUAGE_ID, {
    // .crumb is case-SENSITIVE (SSOT caseInsensitive:false, EISEN M2.T2/§B.1): a
    // name highlights as a CRUMB word ONLY in its exact canonical spelling, exactly
    // like the transpiler classifies it. `If` colours as a keyword, `if`/`iff` stay
    // plain identifiers — so the editor's colours and the build agree.
    ignoreCase: false,
    keywords: names(['keyword']),
    commands: names(['command']),
    functions: names(['function']),
    constants: names(['constant']),
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/"/, { token: 'string.quote', next: '@string' }],
        [/\$[0-9A-Fa-f]+/, 'number.hex'],
        [/%[01]+/, 'number.binary'],
        [/\b\d+\b/, 'number'],
        // Classify identifiers ONLY by exact SSOT membership; unknown → plain.
        // Constants are checked BEFORE commands/functions: a few names exist in
        // the SSOT both as a constant and as a command/function (TEXT, LEFT,
        // RIGHT). A line-based tokenizer can't use context to disambiguate, and
        // those names appear in real code as constants (Graphics TEXT,
        // Joystick(LEFT)), so constant wins for consistent coloring. The real
        // lexer/parser disambiguates by context.
        [
          /\b[A-Za-z_]\w*\b/,
          {
            cases: {
              '@keywords': 'keyword',
              '@constants': 'constant',
              '@commands': 'command',
              '@functions': 'function',
              '@default': 'identifier'
            }
          }
        ],
        [/[=+\-*/<>&|]+/, 'operator']
      ],
      string: [
        [/[^"]+/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }]
      ]
    }
  })
}

const languageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: ';' }, // Sprachdef §B — CRUMB comments start with ';'
  brackets: [
    ['(', ')'],
    ['[', ']']
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' }
  ]
}

export function registerTheme(): void {
  // Token colors mirror the static highlighting used in the design-system mockup
  // (ide.css .code .* classes) so the editor matches the rest of the IDE.
  monaco.editor.defineTheme(BREADCRAFT_THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '555E70', fontStyle: 'italic' },
      { token: 'keyword', foreground: '5EC4FF' },
      { token: 'command', foreground: '2AA7FF' },
      { token: 'constant', foreground: 'F5C291' },
      { token: 'function', foreground: '4ED39A' },
      { token: 'string', foreground: 'FFB57A' },
      { token: 'string.quote', foreground: 'FFB57A' },
      { token: 'number', foreground: 'A6E1FF' },
      { token: 'number.hex', foreground: 'A6E1FF' },
      { token: 'number.binary', foreground: 'A6E1FF' },
      { token: 'operator', foreground: '7C8597' },
      { token: 'identifier', foreground: 'D7DBE3' }
    ],
    colors: {
      'editor.background': '#0A101D',
      'editor.foreground': '#D7DBE3',
      'editorLineNumber.foreground': '#555E70',
      'editorLineNumber.activeForeground': '#A9B1C0',
      'editor.lineHighlightBackground': '#16213A66',
      'editor.selectionBackground': '#2A3E66',
      'editorCursor.foreground': '#5EC4FF',
      'editorIndentGuide.background1': '#16213A',
      'editorWidget.background': '#0F1828',
      'editorWidget.border': '#16213A'
    }
  })
}

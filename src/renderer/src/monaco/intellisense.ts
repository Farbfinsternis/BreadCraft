import * as monaco from 'monaco-editor'
import { CRUMB_LANGUAGE_ID } from './crumb'
import type { EntryKind, VocabItem } from '@renderer/language/ssot'

function completionKind(kind: EntryKind): monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind
  switch (kind) {
    case 'function':
      return K.Function
    case 'command':
      return K.Method
    case 'keyword':
      return K.Keyword
    case 'constant':
      return K.Constant
    case 'type':
      return K.TypeParameter
    case 'operator':
      return K.Operator
    default:
      return K.Text
  }
}

let disposables: monaco.IDisposable[] = []

/**
 * (Re)register the .crumb completion + auto-casing providers from the SSOT
 * vocabulary. Idempotent: disposes any previous registration first.
 *
 * @param vocabulary flattened SSOT items (canonical names + lookup keys)
 * @param canonicalize maps a typed word (any casing/alias) to its canonical name
 */
export function registerIntellisense(
  vocabulary: VocabItem[],
  canonicalize: (word: string) => string | undefined
): void {
  disposables.forEach((d) => d.dispose())
  disposables = []

  // ---- Completion ----
  disposables.push(
    monaco.languages.registerCompletionItemProvider(CRUMB_LANGUAGE_ID, {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        )

        const suggestions: monaco.languages.CompletionItem[] = vocabulary.map((item) => {
          const isFunction = item.kind === 'function'
          const hasParams = (item.params?.length ?? 0) > 0
          // functions always need parens; commands with params get a space.
          let insertText = item.name
          let insertRules: monaco.languages.CompletionItem['insertTextRules'] | undefined
          if (isFunction) {
            insertText = `${item.name}($0)`
            insertRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          } else if (item.kind === 'command' && hasParams) {
            insertText = `${item.name} `
          }

          return {
            label: item.name,
            kind: completionKind(item.kind),
            insertText,
            insertTextRules: insertRules,
            detail: item.category ? `${item.kind} · ${item.category}` : item.kind,
            range
          }
        })

        return { suggestions }
      }
    })
  )

  // ---- Auto-casing ----
  // When a word is completed by a separator (space, paren, newline…), normalize
  // the just-typed token to its canonical SSOT casing. Implemented as an
  // edit-on-type via the model content change is fragile; instead we expose a
  // helper the editor wires to onDidChangeModelContent (see MonacoEditor.vue).
  void canonicalize // (kept in signature; casing logic lives in the editor hook)
}

/**
 * Auto-casing pass over a single line edit: given the full line text and the
 * column where typing just ended, returns a replacement edit if the word
 * before the cursor matches a vocabulary entry under a different casing.
 */
export function autoCaseEdit(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  canonicalize: (word: string) => string | undefined
): void {
  const word = model.getWordUntilPosition(position)
  const typed = word.word
  if (!typed) return

  const canonical = canonicalize(typed)
  if (!canonical || canonical === typed) return

  const range = new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn
  )
  model.applyEdits([{ range, text: canonical }])
}

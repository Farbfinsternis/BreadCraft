import type * as monaco from 'monaco-editor'

// Thin bridge so non-editor components (e.g. the Outliner) can drive the active
// Monaco instance without prop-drilling. MonacoEditor.vue sets/clears it on
// mount/unmount; there is at most one code editor at a time.

let active: monaco.editor.IStandaloneCodeEditor | undefined

export function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor | undefined): void {
  active = editor
}

export function revealLine(line: number): void {
  if (!active) return
  active.revealLineInCenter(line)
  active.setPosition({ lineNumber: line, column: 1 })
  active.focus()
}

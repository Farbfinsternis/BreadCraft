<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import '@renderer/monaco/setup'
import {
  BREADCRAFT_THEME_ID,
  CRUMB_LANGUAGE_ID,
  registerCrumb,
  registerTheme
} from '@renderer/monaco/crumb'
import { autoCaseEdit, registerIntellisense } from '@renderer/monaco/intellisense'
import { setActiveEditor } from '@renderer/monaco/editorBridge'
import type { FileMarker } from '@renderer/monaco/markers'
import { useLanguageStore } from '@renderer/stores/language'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: string
    readonly?: boolean
    /** Build diagnostics for the file on screen (B3.T4) — drawn as squiggles. */
    markers?: FileMarker[]
  }>(),
  { language: CRUMB_LANGUAGE_ID, readonly: false, markers: () => [] }
)

const MARKER_OWNER = 'breadcraft-build'

/** Draw the current `markers` prop onto the editor's model (or clear them). */
function applyMarkers(): void {
  const model = editor?.getModel()
  if (!model) return
  monaco.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    props.markers.map((m) => ({
      severity: m.level === 'warn' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
      message: m.message,
      startLineNumber: m.line,
      startColumn: Math.max(1, m.col),
      endLineNumber: m.line,
      endColumn: Math.max(1, m.col) + 1
    }))
  )
}

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | undefined
const language = useLanguageStore()

onMounted(() => {
  registerCrumb(language.vocabulary)
  registerTheme()
  registerIntellisense(language.vocabulary, language.canonicalize)
  if (!host.value) return

  editor = monaco.editor.create(host.value, {
    value: props.modelValue,
    language: props.language,
    theme: BREADCRAFT_THEME_ID,
    readOnly: props.readonly,
    automaticLayout: true,
    fontFamily: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13.5,
    lineHeight: 22,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    renderLineHighlight: 'line',
    padding: { top: 12 }
  })

  setActiveEditor(editor)
  applyMarkers()

  editor.onDidChangeModelContent((e) => {
    if (!editor) return

    // Auto-casing: when the user just typed a single word-boundary character,
    // normalize the word that precedes it to its canonical SSOT casing.
    const change = e.changes[0]
    if (
      e.changes.length === 1 &&
      /^[\s(),=+\-*/<>&|]$/.test(change.text) &&
      !e.isFlush
    ) {
      const model = editor.getModel()
      if (model) {
        // The boundary char was inserted at change.range.start; the word that
        // should be cased sits immediately before that position.
        const before = new monaco.Position(
          change.range.startLineNumber,
          change.range.startColumn
        )
        autoCaseEdit(model, before, language.canonicalInfo)
      }
    }

    const value = editor.getValue()
    if (value !== props.modelValue) emit('update:modelValue', value)
  })
})

// Keep the editor in sync if the bound value changes from outside. A file switch swaps
// the content AND the markers prop; re-apply markers after setValue so they land on the
// file now on screen (B3.T4).
watch(
  () => props.modelValue,
  (value) => {
    if (editor && value !== editor.getValue()) editor.setValue(value)
    applyMarkers()
  }
)

// Redraw squiggles whenever the diagnostics for the on-screen file change (new build,
// or the user switched to a file that has errors).
watch(() => props.markers, applyMarkers, { deep: true })

onBeforeUnmount(() => {
  setActiveEditor(undefined)
  editor?.dispose()
  editor = undefined
})
</script>

<template>
  <div ref="host" class="monaco-host" />
</template>

<style scoped>
.monaco-host {
  width: 100%;
  height: 100%;
}
</style>

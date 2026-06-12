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
import { useLanguageStore } from '@renderer/stores/language'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: string
    readonly?: boolean
  }>(),
  { language: CRUMB_LANGUAGE_ID, readonly: false }
)

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

// Keep the editor in sync if the bound value changes from outside.
watch(
  () => props.modelValue,
  (value) => {
    if (editor && value !== editor.getValue()) editor.setValue(value)
  }
)

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

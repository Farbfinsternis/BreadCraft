// Monaco worker wiring. Workers are bundled locally by vite-plugin-monaco-editor
// (no CDN), so we point MonacoEnvironment at the bundled editor worker.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker(): Worker {
    return new EditorWorker()
  }
}

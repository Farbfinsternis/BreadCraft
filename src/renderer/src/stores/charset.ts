import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { CHARSET_FILE, parseCharset, serializeCharset } from './assetIo'

/**
 * The pixels of the 256 characters drawn in the PETSCII editor.
 *
 * A pixel stores a COLOUR INDEX 0–3 (the pixel-engine's data model, memory
 * breadcraft-pixel-engine): 0 = background, 1 = shared 1, 2 = shared 2, 3 = free.
 * Each char is a flat Uint8Array of 64 indices (8×8, row-major). Sparse: only
 * edited chars are stored; unedited read as all-0 (background).
 *
 * PERSISTENCE (ASSET_IO.md): the charset now lives on disk as the project's
 * `.petscii` asset, referenced from the `.bread` manifest — project-bound, not
 * the old app-global localStorage (closes memory breadcraft-asset-io-debt). The
 * raw 8-bytes-per-char file is the C64 truth; index↔bytes conversion lives in
 * stores/assetIo.ts. Auto-saved (debounced) + a manual save(); a dirty flag
 * drives the editor's save indicator.
 */

const PIXELS = 64

export const useCharsetStore = defineStore('charset', () => {
  // Sparse: only edited chars are stored; unedited read as all-'0' (background).
  const chars = reactive<Record<number, Uint8Array>>({})
  const dirty = ref(false)

  // The project this charset belongs to (set on load). Saves target this dir.
  let projectDir: string | null = null
  let assetRel: string = CHARSET_FILE

  /** Pixels of a character (always 64; lazily created on first access). */
  function pixels(charIndex: number): Uint8Array {
    if (!chars[charIndex]) chars[charIndex] = new Uint8Array(PIXELS)
    return chars[charIndex]
  }

  /** Replace all pixels of a character (the editor commits whole-grid updates).
   *  Marks dirty only — saving is EXPLICIT (button / Ctrl+S), never automatic
   *  (ASSET_DOCUMENTS.md §2.5: unsaved edits are lost on restart, by design). */
  function setPixels(charIndex: number, cells: Uint8Array): void {
    if (cells.length !== PIXELS) return
    chars[charIndex] = cells.slice()
    dirty.value = true
  }

  /** True if a character has any non-background pixel (for the "X/256" counter). */
  function isUsed(charIndex: number): boolean {
    const p = chars[charIndex]
    return !!p && p.some((idx) => idx !== 0)
  }

  function usedCount(): number {
    let n = 0
    for (const idx of Object.keys(chars)) {
      if (isUsed(Number(idx))) n++
    }
    return n
  }

  /** Load the project's charset asset from disk (called on project open). */
  async function loadForProject(dir: string, rel: string | null): Promise<void> {
    projectDir = dir
    assetRel = rel ?? CHARSET_FILE
    for (const key of Object.keys(chars)) delete chars[Number(key)]
    dirty.value = false
    if (!rel) return // no charset asset yet — start empty
    const text = await window.breadcraft.assets.read(dir, rel)
    if (!text) return
    const parsed = parseCharset(text)
    if (parsed) for (const [k, v] of Object.entries(parsed)) chars[Number(k)] = v
  }

  /** Write the charset to disk (explicit save: button / Ctrl+S). */
  async function save(): Promise<void> {
    if (!projectDir) return
    await window.breadcraft.assets.write(projectDir, 'charset', assetRel, serializeCharset(chars))
    dirty.value = false
  }

  return { chars, dirty, pixels, setPixels, isUsed, usedCount, loadForProject, save }
})

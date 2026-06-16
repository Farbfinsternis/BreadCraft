import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  CHARSET_FILE,
  parseCharset,
  parseCharsetSolid,
  serializeCharset,
  pixelsPerChar
} from './assetIo'
import { useProjectStore } from './project'

/**
 * The pixels of the 256 characters drawn in the PETSCII editor.
 *
 * A pixel stores a COLOUR INDEX 0–3 (the pixel-engine's data model, memory
 * breadcraft-pixel-engine): 0 = background, 1 = shared 1, 2 = shared 2, 3 = free.
 * Each char is a flat Uint8Array of index cells, row-major. The grid SIZE follows
 * the project's graphics mode: hi-res 8×8 = 64 cells, MC 4×8 = 32 double-pixels
 * (pixelsPerChar). Sparse: only edited chars are stored; unedited read as all-0.
 *
 * PERSISTENCE (ASSET_IO.md): the charset now lives on disk as the project's
 * `.petscii` asset, referenced from the `.bread` manifest — project-bound, not
 * the old app-global localStorage (closes memory breadcraft-asset-io-debt). The
 * raw 8-bytes-per-char file is the C64 truth; index↔bytes conversion follows the
 * mode (MC keeps all 4 colours — fixes the data-loss bug) and lives in
 * stores/assetIo.ts. Saving is explicit (button / Ctrl+S); a dirty flag drives
 * the editor's save indicator.
 */

export const useCharsetStore = defineStore('charset', () => {
  // Sparse: only edited chars are stored; unedited read as all-'0' (background).
  const chars = reactive<Record<number, Uint8Array>>({})
  // Per-slot SOLIDITY (S11): a tile flagged here blocks the player. Collision is a
  // property of the TILE, not its map position — marked in the PETSCII editor, baked
  // into the build's bc_solid[] table. Sparse: only solid slots hold `true`.
  const solid = reactive<Record<number, boolean>>({})
  const dirty = ref(false)

  // The project this charset belongs to (set on load). Saves target this dir.
  let projectDir: string | null = null
  let assetRel: string = CHARSET_FILE

  /** Cells per char for the active project mode (64 hi-res / 32 MC). */
  function cellsPerChar(): number {
    return pixelsPerChar(useProjectStore().graphicsMode)
  }

  /** Pixels of a character (mode-sized; lazily created on first access). */
  function pixels(charIndex: number): Uint8Array {
    if (!chars[charIndex]) chars[charIndex] = new Uint8Array(cellsPerChar())
    return chars[charIndex]
  }

  /** Replace all pixels of a character (the editor commits whole-grid updates).
   *  Marks dirty only — saving is EXPLICIT (button / Ctrl+S), never automatic
   *  (ASSET_DOCUMENTS.md §2.5: unsaved edits are lost on restart, by design). */
  function setPixels(charIndex: number, cells: Uint8Array): void {
    if (cells.length !== cellsPerChar()) return
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

  // ---- solidity (S11) ----

  /** Is this tile marked solid (blocks the player)? */
  function isSolid(charIndex: number): boolean {
    return solid[charIndex] === true
  }

  /** Mark/unmark a tile solid. Marks dirty (explicit save persists it). */
  function setSolid(charIndex: number, value: boolean): void {
    if (charIndex < 0 || charIndex > 255) return
    if (value) solid[charIndex] = true
    else delete solid[charIndex]
    dirty.value = true
  }

  /** A dense 256-entry boolean array for the serializer (true = solid). */
  function solidFlags(): boolean[] {
    const flags = new Array<boolean>(256).fill(false)
    for (const idx of Object.keys(solid)) if (solid[Number(idx)]) flags[Number(idx)] = true
    return flags
  }

  function solidCount(): number {
    let n = 0
    for (const idx of Object.keys(solid)) if (solid[Number(idx)]) n++
    return n
  }

  /** Load the project's charset asset from disk (called on project open). */
  async function loadForProject(dir: string, rel: string | null): Promise<void> {
    projectDir = dir
    assetRel = rel ?? CHARSET_FILE
    for (const key of Object.keys(chars)) delete chars[Number(key)]
    for (const key of Object.keys(solid)) delete solid[Number(key)]
    dirty.value = false
    if (!rel) return // no charset asset yet — start empty
    const text = await window.breadcraft.assets.read(dir, rel)
    if (!text) return
    const parsed = parseCharset(text, useProjectStore().graphicsMode)
    if (parsed) for (const [k, v] of Object.entries(parsed)) chars[Number(k)] = v
    const flags = parseCharsetSolid(text)
    for (let i = 0; i < flags.length; i++) if (flags[i]) solid[i] = true
  }

  /** Write the charset to disk (explicit save: button / Ctrl+S). */
  async function save(): Promise<void> {
    if (!projectDir) return
    const text = serializeCharset(chars, useProjectStore().graphicsMode, solidFlags())
    await window.breadcraft.assets.write(projectDir, 'charset', assetRel, text)
    dirty.value = false
  }

  function currentRel(): string {
    return assetRel
  }

  /** Switch the editor to another charset file (P2.T0): save pending, then load. */
  async function switchAsset(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    await loadForProject(dir, rel)
  }

  /** Create a NEW empty charset file at `rel` and bind to it (P2.T0). */
  async function createBlank(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    projectDir = dir
    assetRel = rel
    for (const key of Object.keys(chars)) delete chars[Number(key)]
    for (const key of Object.keys(solid)) delete solid[Number(key)]
    dirty.value = false
    const text = serializeCharset(chars, useProjectStore().graphicsMode, solidFlags())
    await window.breadcraft.assets.write(dir, 'charset', rel, text)
  }

  /** "Save as" (P2.T0b): bind to a new rel and write the CURRENT chars there. */
  async function saveTo(dir: string, rel: string): Promise<void> {
    projectDir = dir
    assetRel = rel
    const text = serializeCharset(chars, useProjectStore().graphicsMode, solidFlags())
    await window.breadcraft.assets.write(dir, 'charset', rel, text)
    dirty.value = false
  }

  return {
    chars,
    solid,
    dirty,
    pixels,
    setPixels,
    isUsed,
    usedCount,
    isSolid,
    setSolid,
    solidCount,
    loadForProject,
    save,
    currentRel,
    switchAsset,
    createBlank,
    saveTo
  }
})

import { ref } from 'vue'
import { defineStore } from 'pinia'
import { IMAGE_FILE, IMAGE_W, IMAGE_H, serializeImage, parseImage } from './assetIo'
import { C64_PALETTE, usePaletteStore } from './palette'
import { reconcileCells, cellsInBox } from '@renderer/pixel-engine/imageCells'

/**
 * The image store (BRONZE B2.T2) — mirrors the sprite/charset stores, but holds ONE
 * MC-bitmap screen as a flat 16-colour-per-pixel buffer (160×200, values 0–15). The
 * editor paints whole-buffer updates (its own undo lives in the view's engine); saving
 * is EXPLICIT (button / Ctrl+S), never automatic (ASSET_DOCUMENTS.md §2.5).
 *
 * The shared background ($D021) is the project palette's — not stored here — so on
 * SAVE we reconcile the canvas to a C64-legal ≤(bg+3)-per-cell shape (a Free-mode
 * clash snaps to the nearest affordable colour) WITHOUT touching the live buffer, then
 * pack it to the three C64 byte planes. Legal art round-trips losslessly.
 */

const CANVAS_CELLS = IMAGE_W * IMAGE_H

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

const PAL_RGB = C64_PALETTE.map((c) => hexToRgb(c.hex))

export const useImageStore = defineStore('image', () => {
  const pixels = ref<Uint8Array>(new Uint8Array(CANVAS_CELLS))
  const dirty = ref(false)
  // Bumped whenever the buffer is REPLACED from outside (load / switch / new) — never
  // on an in-editor edit — so the view reloads its engine (and undo history) then only.
  const loadToken = ref(0)

  // The project this image belongs to (set on load). Saves target this dir.
  let projectDir: string | null = null
  let assetRel: string = IMAGE_FILE

  /** A blank canvas filled with the given background colour. */
  function blank(bg: number): Uint8Array {
    return new Uint8Array(CANVAS_CELLS).fill(bg)
  }

  /** The current project background ($D021) — the image's 4th, budget-free colour. */
  function background(): number {
    return usePaletteStore().background
  }

  /** Replace the canvas (the editor commits whole-buffer updates). Marks dirty. */
  function setPixels(buf: Uint8Array): void {
    if (buf.length !== CANVAS_CELLS) return
    pixels.value = buf.slice()
    dirty.value = true
  }

  /** Load the project's image asset from disk (called on project open). A missing or
   *  malformed file yields a blank canvas in the project background. */
  async function loadForProject(dir: string, rel: string | null): Promise<void> {
    projectDir = dir
    assetRel = rel ?? IMAGE_FILE
    let next = blank(background())
    if (rel) {
      const text = await window.breadcraft.assets.read(dir, rel)
      if (text) {
        const parsed = parseImage(text)
        if (parsed) next = parsed.pixels
      }
    }
    pixels.value = next
    dirty.value = false
    loadToken.value++
  }

  /** A C64-legal copy of the canvas: every cell reconciled to ≤ background + 3 colours
   *  (Free-mode clashes snap to the nearest affordable colour). Non-destructive — the
   *  live buffer keeps the artist's colours; only the SAVED bytes are made legal. */
  function legalSnapshot(): Uint8Array {
    const bg = background()
    const snap = pixels.value.slice()
    const all = cellsInBox(0, 0, IMAGE_W - 1, IMAGE_H - 1, IMAGE_W, IMAGE_H)
    for (const w of reconcileCells(snap, IMAGE_W, all, bg, PAL_RGB)) {
      snap[w.y * IMAGE_W + w.x] = w.value
    }
    return snap
  }

  /** Write the image to disk (explicit save: button / Ctrl+S). */
  async function save(): Promise<void> {
    if (!projectDir) return
    const text = serializeImage({ pixels: legalSnapshot(), background: background() })
    await window.breadcraft.assets.write(projectDir, 'image', assetRel, text)
    dirty.value = false
  }

  /** The rel currently bound (which file save() targets) — for the explorer marker. */
  function currentRel(): string {
    return assetRel
  }

  /** Switch the editor to another image file (save pending edits first, then load). */
  async function switchAsset(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    await loadForProject(dir, rel)
  }

  /** Create a NEW blank image file at `rel` and bind to it (registers it in .bread). */
  async function createBlank(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    projectDir = dir
    assetRel = rel
    pixels.value = blank(background())
    dirty.value = false
    loadToken.value++
    await save()
  }

  /** Start a fresh, UNSAVED image (blank canvas, unbound). Nothing hits disk until a
   *  later "Save as"; an unkept doodle leaves no file (mirrors the sprite scratch pad). */
  function newBlank(): void {
    projectDir = null
    assetRel = IMAGE_FILE
    pixels.value = blank(background())
    dirty.value = false
    loadToken.value++
  }

  /** "Save as": bind to a new rel and write the CURRENT canvas there. */
  async function saveTo(dir: string, rel: string): Promise<void> {
    projectDir = dir
    assetRel = rel
    const text = serializeImage({ pixels: legalSnapshot(), background: background() })
    await window.breadcraft.assets.write(dir, 'image', rel, text)
    dirty.value = false
  }

  return {
    pixels,
    dirty,
    loadToken,
    setPixels,
    loadForProject,
    save,
    currentRel,
    switchAsset,
    createBlank,
    newBlank,
    saveTo
  }
})

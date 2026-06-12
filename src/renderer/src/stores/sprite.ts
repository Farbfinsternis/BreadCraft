import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  SPRITE_FILE,
  DEFAULT_SPRITE_COLOR,
  parseSprite,
  serializeSprite,
  type SpriteData
} from './assetIo'
import { pixelsPerSprite } from '@renderer/pixel-engine/spriteBytes'
import { useProjectStore } from './project'

/**
 * The sprite store (P2.T2) — mirrors the charset store, but holds ONE figure as a
 * list of animation FRAMES (the P2.T1 decision: one sprite/file, animatable). Each
 * frame is a mode-sized index grid (hi-res 24×21 = 504 cells, MC 12×21 = 252). The
 * editor paints whole-grid updates; saving is EXPLICIT (button / Ctrl+S), never
 * automatic (ASSET_DOCUMENTS.md §2.5). A blank sprite always has at least frame 0.
 */
export const useSpriteStore = defineStore('sprite', () => {
  // Frames are reactive so the editor's strip + canvas track add/remove/edit.
  const frames = reactive<Uint8Array[]>([])
  // The figure's individual multicolor (spr_color, the "10" pair) as a C64 index 0–15.
  // Per-sprite (player ≠ blob); the two SHARED colours come from the project palette.
  const color = ref(DEFAULT_SPRITE_COLOR)
  const dirty = ref(false)

  // The project this sprite belongs to (set on load). Saves target this dir.
  let projectDir: string | null = null
  let assetRel: string = SPRITE_FILE

  /** Cells per frame for the active project mode (504 hi-res / 252 MC). */
  function cellsPerFrame(): number {
    return pixelsPerSprite(useProjectStore().graphicsMode)
  }

  /** Ensure at least one frame exists (a fresh sprite starts with a blank frame 0). */
  function ensureFrame(): void {
    if (frames.length === 0) frames.push(new Uint8Array(cellsPerFrame()))
  }

  /** The pixel grid of a frame (mode-sized; lazily created/normalised on access). */
  function pixels(frameIndex: number): Uint8Array {
    ensureFrame()
    const i = Math.max(0, Math.min(frameIndex, frames.length - 1))
    if (frames[i].length !== cellsPerFrame()) frames[i] = new Uint8Array(cellsPerFrame())
    return frames[i]
  }

  /** Replace a frame's pixels (the editor commits whole-grid updates). Marks dirty. */
  function setPixels(frameIndex: number, cells: Uint8Array): void {
    if (cells.length !== cellsPerFrame()) return
    if (frameIndex < 0 || frameIndex >= frames.length) return
    frames[frameIndex] = cells.slice()
    dirty.value = true
  }

  /** Append a new blank frame; returns its index (the editor selects it). */
  function addFrame(): number {
    ensureFrame()
    frames.push(new Uint8Array(cellsPerFrame()))
    dirty.value = true
    return frames.length - 1
  }

  /** Remove a frame; never drops the last one (a sprite always has frame 0). */
  function removeFrame(frameIndex: number): void {
    if (frames.length <= 1) return
    if (frameIndex < 0 || frameIndex >= frames.length) return
    frames.splice(frameIndex, 1)
    dirty.value = true
  }

  function frameCount(): number {
    return frames.length
  }

  /** Load the project's sprite asset from disk (called on project open).
   *
   *  IMPORTANT: we read the file FIRST, then swap `frames` in a single synchronous
   *  step. Splicing `frames` empty before the `await` left a window where the
   *  editor's reactive computeds (pixels()/framePreview) ran against zero frames →
   *  `ensureFrame()` injected a blank frame 0, and the parsed frames landed at 1…n.
   *  That was the "sprite slides to frame 1, empty frame 0" bug. Build the new list
   *  off to the side; never expose a transient empty state. */
  async function loadForProject(dir: string, rel: string | null): Promise<void> {
    projectDir = dir
    assetRel = rel ?? SPRITE_FILE

    const next: Uint8Array[] = []
    let nextColor = DEFAULT_SPRITE_COLOR
    if (rel) {
      const text = await window.breadcraft.assets.read(dir, rel)
      if (text) {
        const parsed = parseSprite(text, useProjectStore().graphicsMode)
        if (parsed) {
          next.push(...parsed.frames)
          nextColor = parsed.color
        }
      }
    }
    if (next.length === 0) next.push(new Uint8Array(cellsPerFrame())) // blank frame 0

    frames.splice(0, frames.length, ...next)
    color.value = nextColor
    dirty.value = false
  }

  /** Set the figure's individual colour (C64 index 0–15). Marks dirty; explicit save. */
  function setColor(index: number): void {
    if (index < 0 || index > 15 || color.value === index) return
    color.value = index
    dirty.value = true
  }

  /** Snapshot the current sprite as SpriteData (frames copied + the individual colour). */
  function snapshot(): SpriteData {
    return { frames: frames.map((f) => f.slice()), color: color.value }
  }

  /** Write the sprite to disk (explicit save: button / Ctrl+S). */
  async function save(): Promise<void> {
    if (!projectDir) return
    ensureFrame()
    const text = serializeSprite(snapshot(), useProjectStore().graphicsMode)
    await window.breadcraft.assets.write(projectDir, 'sprite', assetRel, text)
    dirty.value = false
  }

  /** The rel currently bound (which file save() targets) — for the explorer marker. */
  function currentRel(): string {
    return assetRel
  }

  /** Switch the editor to another sprite file (P2.T0): save pending edits, then load
   *  the new rel. The explorer calls this when the user picks a different sprite. */
  async function switchAsset(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    await loadForProject(dir, rel)
  }

  /** Create a NEW empty sprite file at `rel` (one blank frame) and bind to it (P2.T0).
   *  Writing registers it in the .bread manifest (writeAsset appends). */
  async function createBlank(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    projectDir = dir
    assetRel = rel
    frames.splice(0, frames.length)
    ensureFrame()
    color.value = DEFAULT_SPRITE_COLOR
    dirty.value = false
    const text = serializeSprite(snapshot(), useProjectStore().graphicsMode)
    await window.breadcraft.assets.write(dir, 'sprite', rel, text)
  }

  /** Start a fresh, UNSAVED sprite: clear the canvas to a single blank frame and
   *  unbind from any file. Nothing is written to disk — the sprite editor is a
   *  scratch pad; the file is born only when the user later chooses "Save as". A
   *  subsequent save() is a no-op until then (no projectDir), so an unkept doodle
   *  leaves no trace. Caller is responsible for asking before discarding edits. */
  function newBlank(): void {
    projectDir = null
    assetRel = SPRITE_FILE
    frames.splice(0, frames.length, new Uint8Array(cellsPerFrame()))
    color.value = DEFAULT_SPRITE_COLOR
    dirty.value = false
  }

  /** "Save as" (P2.T0b): bind to a new rel and write the CURRENT frames there (keeps
   *  what's on the canvas, unlike createBlank which empties). */
  async function saveTo(dir: string, rel: string): Promise<void> {
    projectDir = dir
    assetRel = rel
    ensureFrame()
    const text = serializeSprite(snapshot(), useProjectStore().graphicsMode)
    await window.breadcraft.assets.write(dir, 'sprite', rel, text)
    dirty.value = false
  }

  return {
    frames,
    color,
    dirty,
    pixels,
    setPixels,
    setColor,
    addFrame,
    removeFrame,
    frameCount,
    loadForProject,
    save,
    currentRel,
    switchAsset,
    createBlank,
    newBlank,
    saveTo
  }
})

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { PALETTE_FILE, parsePalette, serializePalette } from './assetIo'
import type { GraphicsMode } from '@shared/ipc'

/**
 * The ONE project palette (phase 1) — see _plans/_sprints/PALETTE_FORMAT.md and
 * BREADCRAFT_IDE.md §3.2. Holds only the few SHARED C64 registers, each as an
 * index 0–15 into the fixed C64 palette (never RGB). The "free" colours
 * (per-sprite, per-cell Color-RAM) do NOT live here.
 *
 * The shared registers are coupled in hardware (bgcolor1 = spr_mcolor0,
 * bgcolor2 = spr_mcolor1), so changing one here affects tiles AND sprites
 * project-wide — that coupling is the whole point (memory breadcraft-project-palette).
 *
 * PERSISTENCE (ASSET_IO.md): the palette is the project's `.palette` asset on
 * disk, referenced from the `.bread` manifest — project-bound, not the old
 * app-global localStorage (closes memory breadcraft-asset-io-debt). Auto-saved
 * (debounced) + a manual save(); a dirty flag drives the editor's save indicator.
 */

/** The 16 fixed C64 colours (index = hardware colour number). The human name is
 *  NOT stored here — it lives in the i18n layer under `color.*` (the SSOT colour
 *  keys, memory breadcraft-localization), so each colour carries a stable i18nKey
 *  the views translate via t(). Hex values are the canonical VICE/Pepto-ish set. */
export interface C64Color {
  index: number
  /** i18n key for the colour name, e.g. 'color.black' (resolved via t()). */
  i18nKey: string
  hex: string
}

export const C64_PALETTE: readonly C64Color[] = [
  { index: 0, i18nKey: 'color.black', hex: '#000000' },
  { index: 1, i18nKey: 'color.white', hex: '#FFFFFF' },
  { index: 2, i18nKey: 'color.red', hex: '#68372B' },
  { index: 3, i18nKey: 'color.cyan', hex: '#70A4B2' },
  { index: 4, i18nKey: 'color.purple', hex: '#6F3D86' },
  { index: 5, i18nKey: 'color.green', hex: '#588D43' },
  { index: 6, i18nKey: 'color.blue', hex: '#352879' },
  { index: 7, i18nKey: 'color.yellow', hex: '#B8C76F' },
  { index: 8, i18nKey: 'color.orange', hex: '#6F4F25' },
  { index: 9, i18nKey: 'color.brown', hex: '#433900' },
  { index: 10, i18nKey: 'color.lightred', hex: '#9A6759' },
  { index: 11, i18nKey: 'color.gray1', hex: '#444444' },
  { index: 12, i18nKey: 'color.gray2', hex: '#6C6C6C' },
  { index: 13, i18nKey: 'color.lightgreen', hex: '#9AD284' },
  { index: 14, i18nKey: 'color.lightblue', hex: '#6C5EB5' },
  { index: 15, i18nKey: 'color.gray3', hex: '#959595' }
] as const

/** A slot of the project palette. `role` is the C64 hardware role; `index` is
 *  which of the 16 fixed colours fills it. Matches the `.palette` schema fields. */
export type SlotKey = 'background' | 'shared1' | 'shared2'

export interface SlotMeta {
  key: SlotKey
  /** i18n key for the layman-friendly label (newbie-first, memory
   *  breadcraft-nerd-newbie-spagat); resolved via t(). */
  labelKey: string
  /** i18n key for the one-sentence plain explanation shown in the editor. */
  hintKey: string
  /** The hardware register, for the honest detail line (not localized — a fact). */
  register: string
}

export const SLOTS: readonly SlotMeta[] = [
  {
    key: 'background',
    labelKey: 'palette.slot.background.label',
    hintKey: 'palette.slot.background.hint',
    register: 'bgcolor0 ($D021)'
  },
  {
    key: 'shared1',
    labelKey: 'palette.slot.shared1.label',
    hintKey: 'palette.slot.shared1.hint',
    register: 'bgcolor1 ($D022) = spr_mcolor0 ($D025)'
  },
  {
    key: 'shared2',
    labelKey: 'palette.slot.shared2.label',
    hintKey: 'palette.slot.shared2.hint',
    register: 'bgcolor2 ($D023) = spr_mcolor1 ($D026)'
  }
] as const

/**
 * Which palette slots the project's graphics mode actually uses (PALETTE_EDITOR.md
 * §4, IDE.md §2.1). Hi-res chars have only 2 colours — a project-wide background
 * plus a per-cell foreground (Color-RAM) — so the two SHARED multicolor registers
 * are meaningless there: only `background` is relevant. Multicolor uses all three
 * shared registers. The editor shows only the relevant slots so it never offers a
 * knob that does nothing (cost-honesty, no fake controls).
 */
export function slotsForMode(mode: GraphicsMode): readonly SlotMeta[] {
  if (mode === 'TEXT_HIRES') return SLOTS.filter((s) => s.key === 'background')
  return SLOTS // TEXT_MULTICOLOR / BITMAP_MULTICOLOR → all three shared registers
}

export const usePaletteStore = defineStore('palette', () => {
  // Default to a readable, distinct trio (black bg, brown, light-blue) until a
  // project's .palette is loaded.
  const background = ref(0)
  const shared1 = ref(9)
  const shared2 = ref(14)
  const dirty = ref(false)

  const slots = { background, shared1, shared2 } as const

  let projectDir: string | null = null
  let assetRel: string = PALETTE_FILE

  const colorOf = computed(() => (key: SlotKey): C64Color => C64_PALETTE[slots[key].value])

  /** Set a shared register. Marks dirty only — saving is EXPLICIT (button / Ctrl+S),
   *  never automatic (ASSET_DOCUMENTS.md §2.5). */
  function setSlot(key: SlotKey, index: number): void {
    if (index < 0 || index > 15) return
    if (slots[key].value === index) return
    slots[key].value = index
    dirty.value = true
  }

  /** Load the project's palette asset from disk (called on project open). */
  async function loadForProject(dir: string, rel: string | null): Promise<void> {
    projectDir = dir
    assetRel = rel ?? PALETTE_FILE
    dirty.value = false
    if (rel) {
      const text = await window.breadcraft.assets.read(dir, rel)
      const parsed = text ? parsePalette(text) : null
      if (parsed) {
        background.value = parsed.background
        shared1.value = parsed.shared1
        shared2.value = parsed.shared2
        return
      }
    }
    // No (valid) palette asset yet → keep defaults; they'll be saved on first edit.
  }

  /** Write the palette to disk (explicit save: button / Ctrl+S). */
  async function save(): Promise<void> {
    if (!projectDir) return
    const content = serializePalette({
      background: background.value,
      shared1: shared1.value,
      shared2: shared2.value
    })
    await window.breadcraft.assets.write(projectDir, 'palette', assetRel, content)
    dirty.value = false
  }

  function currentRel(): string {
    return assetRel
  }

  /** Switch to another palette file (P2.T0): save pending, then load. (The project
   *  palette is normally singular, but the explorer treats all kinds uniformly.) */
  async function switchAsset(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    await loadForProject(dir, rel)
  }

  /** Create a NEW palette file at `rel` (current colours) and bind to it (P2.T0). */
  async function createBlank(dir: string, rel: string): Promise<void> {
    if (dirty.value) await save()
    projectDir = dir
    assetRel = rel
    dirty.value = false
    await save()
  }

  /** "Save as" (P2.T0b): bind to a new rel and write the current colours there. */
  async function saveTo(dir: string, rel: string): Promise<void> {
    projectDir = dir
    assetRel = rel
    await save()
  }

  return {
    background,
    shared1,
    shared2,
    dirty,
    colorOf,
    setSlot,
    loadForProject,
    save,
    currentRel,
    switchAsset,
    createBlank,
    saveTo
  }
})

/**
 * Asset serialization + project-bound disk IO for the renderer (ASSET_IO.md §3/§4).
 * The main process does the raw file write/read + .bread manifest; here we turn
 * editor state into the on-disk FORMAT and back. One small module both asset
 * stores (palette, charset) lean on — closes memory breadcraft-asset-io-debt.
 */
import { indicesToBytesHires, bytesToIndicesHires } from '@renderer/pixel-engine/charsetBytes'

/** Default file names for the single-per-project assets. */
export const PALETTE_FILE = 'project.palette'
export const CHARSET_FILE = 'main.petscii'

const PIXELS = 64
const CHAR_COUNT = 256

// ---- Palette (.palette) ----

export interface PaletteData {
  background: number
  shared1: number
  shared2: number
}

/** Serialize the project palette to the `.palette` JSON (PALETTE_FORMAT.md). */
export function serializePalette(p: PaletteData): string {
  return JSON.stringify(
    { format: 'breadcraft.palette', version: 1, ...p },
    null,
    2
  )
}

/** Parse a `.palette` file; returns null if malformed. */
export function parsePalette(text: string): PaletteData | null {
  try {
    const raw = JSON.parse(text) as Partial<PaletteData>
    const clamp = (n: unknown, d: number): number =>
      typeof n === 'number' && n >= 0 && n <= 15 ? n : d
    return {
      background: clamp(raw.background, 0),
      shared1: clamp(raw.shared1, 9),
      shared2: clamp(raw.shared2, 14)
    }
  } catch {
    return null
  }
}

// ---- Charset (.petscii) ----

/**
 * Serialize the 256-char index grid to the `.petscii` JSON: 256 dense slots, 8
 * raw C64 bytes each (PETSCII_FORMAT.md §4). Hi-res packing for now (ASSET_IO.md
 * §3.1). `chars` is sparse (only edited indices present); missing chars write as
 * empty (8 zero bytes).
 */
export function serializeCharset(chars: Record<number, Uint8Array>): string {
  const out: number[][] = []
  for (let i = 0; i < CHAR_COUNT; i++) {
    const cells = chars[i]
    out.push(Array.from(cells ? indicesToBytesHires(cells) : new Uint8Array(8)))
  }
  return JSON.stringify({ format: 'breadcraft.petscii', version: 1, charCount: CHAR_COUNT, chars: out })
}

/**
 * Parse a `.petscii` file into the sparse index-grid map the store holds. Only
 * non-empty chars are kept (matches the store's sparse model). Returns null if
 * malformed.
 */
export function parseCharset(text: string): Record<number, Uint8Array> | null {
  try {
    const raw = JSON.parse(text) as { chars?: number[][] }
    if (!Array.isArray(raw.chars)) return null
    const result: Record<number, Uint8Array> = {}
    for (let i = 0; i < raw.chars.length && i < CHAR_COUNT; i++) {
      const bytes = raw.chars[i]
      if (!Array.isArray(bytes) || bytes.length !== 8) continue
      if (bytes.every((b) => b === 0)) continue // empty slot → stay sparse
      const cells = bytesToIndicesHires(Uint8Array.from(bytes))
      if (cells.length === PIXELS) result[i] = cells
    }
    return result
  } catch {
    return null
  }
}

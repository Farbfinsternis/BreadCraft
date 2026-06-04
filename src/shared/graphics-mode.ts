// The ONE place the project's graphics mode (the UI/`.bread` constant) and the
// `Graphics …` source command speak the same language (M1.T4, IDE.md §2.1 Anm.).
//
// A GraphicsMode is `{AREA}_{COLOR}` (e.g. TEXT_MULTICOLOR). Both halves are SSOT
// enum values — AREA in `GfxArea`, COLOR in `GfxColor` (breadcraft.lang.json). So
// the mapping is NOT hardcoded: we split the mode and resolve each half against
// the SSOT enums, then assemble the command from their canonical names. If the
// SSOT ever recases/renames an axis, the generated `Graphics …` follows.

import type { GraphicsMode } from './ipc'
import type { Ssot } from './ssot-types'

const GFX_AREA_ENUM = 'GfxArea'
const GFX_COLOR_ENUM = 'GfxColor'

/** The two SSOT enum-value halves of a GraphicsMode (split on the single `_`). */
function splitMode(mode: GraphicsMode): { area: string; color: string } {
  const i = mode.indexOf('_')
  if (i < 0) throw new Error(`Ungültiger Grafikmodus (kein AREA_COLOR): ${mode}`)
  return { area: mode.slice(0, i), color: mode.slice(i + 1) }
}

/** Find an enum's value by its `value` field; throws if the SSOT lacks it. */
function resolveEnumName(ssot: Ssot, enumId: string, value: string): string {
  const e = ssot.enums.find((x) => x.id === enumId)
  if (!e) throw new Error(`SSOT-Enum fehlt: ${enumId}`)
  const v = e.values.find((x) => String(x.value) === value)
  if (!v) throw new Error(`SSOT-Enum ${enumId} kennt den Wert nicht: ${value}`)
  return v.name
}

/**
 * Build the `Graphics …` source line for a project's graphics mode, with the area
 * and colour keyword spelled exactly as the SSOT defines them. Example:
 *   TEXT_MULTICOLOR → "Graphics TEXT, MULTICOLOR"
 */
export function graphicsCommandFor(ssot: Ssot, mode: GraphicsMode): string {
  const { area, color } = splitMode(mode)
  const areaName = resolveEnumName(ssot, GFX_AREA_ENUM, area)
  const colorName = resolveEnumName(ssot, GFX_COLOR_ENUM, color)
  return `Graphics ${areaName}, ${colorName}`
}

/**
 * Shared asset-format codecs (Befund 23): pure string↔byte-level parse/serialize per
 * format, with NO fs and NO Vue/renderer imports — the one place the on-disk FORMAT
 * (field names, structure, dimensions, version) is defined. Both the renderer asset
 * store (`assetIo.ts`, tolerant) and the build resolver (`asset-resolver.ts`, strict)
 * call these and layer their own error policy on top, so a format change lands once
 * and reaches both sides. Import namespaced (`import * as fmt from '@shared/asset-formats'`)
 * to avoid clashing with each side's own `parseX`/`serializeX` wrappers.
 */
export { AssetFormatError } from './error'

export {
  CHARSET_FORMAT,
  CHAR_COUNT,
  BYTES_PER_CHAR,
  serializeCharset,
  parseCharset
} from './charset'

export {
  TILEMAP_FORMAT,
  MAP_W,
  MAP_H,
  MAP_CELLS,
  DEFAULT_COLOR_RAM,
  serializeTilemap,
  parseTilemap,
  type TilemapLayerRaw
} from './tilemap'

export { PALETTE_FORMAT, serializePalette, parsePalette, type PaletteRaw } from './palette'

export {
  SPRITE_FORMAT,
  SPRITE_BYTES,
  DEFAULT_SPRITE_COLOR,
  serializeSprite,
  parseSprite,
  type SpriteRaw
} from './sprite'

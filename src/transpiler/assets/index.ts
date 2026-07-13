// Public surface of the .bread asset bridge (id string → C64 bytes + metadata).
export {
  resolveCharset,
  resolveTilemap,
  resolveSprite,
  resolvePalette,
  resolveImage,
  DEFAULT_PALETTE,
  AssetResolveError
} from './asset-resolver'
export type {
  AssetManifest,
  AssetReader,
  ResolvedCharset,
  ResolvedTilemap,
  ResolvedSprite,
  ResolvedPalette,
  ResolvedImage
} from './asset-resolver'

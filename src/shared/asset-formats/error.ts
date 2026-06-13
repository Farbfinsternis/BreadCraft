/**
 * A structural problem found while decoding an on-disk asset format (broken JSON,
 * missing required field, wrong shape). The shared codecs throw this; each layer
 * then applies its own policy: the editor catches it and loads tolerantly (null /
 * empty), the build resolver rethrows it as an AssetResolveError with the file path
 * and source position. The message is a bare predicate phrase ("ist kein gültiges
 * .petscii …", "hat keine 'chars'-Daten") so a caller can prefix the asset label
 * and read as one sentence: `Tileset 'main.petscii' ist kein gültiges .petscii …`.
 */
export class AssetFormatError extends Error {}

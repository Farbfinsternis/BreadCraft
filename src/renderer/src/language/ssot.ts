// The SSOT types now live in src/shared so the transpiler can share them without
// depending on the renderer. This module re-exports them for existing
// @renderer/language/ssot imports (Monaco intellisense, crumb tokenizer).
export type {
  EntryKind,
  SsotParam,
  SsotEntry,
  SsotEnumValue,
  SsotEnum,
  SsotType,
  Ssot,
  VocabItem
} from '@shared/ssot-types'

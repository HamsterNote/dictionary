export * from './contracts';
export * from './identity';
export * from './scope';
export * from './review';
export * from './resolve';
export * from './legacy';
export * from './corrections';
export * from './query';
export {
  CLASSIFICATION_RULE_VERSION,
  classifyObservation,
  buildReadingPlan,
  safeDedup,
  deriveNotation,
  deriveCompleteness,
} from './classification';
export type {
  Classification,
  ClassificationOptions,
  PlannedReading,
  ReadingPlan,
} from './classification';
export { DictionaryPronunciationOverlay } from '../DictionaryPronunciationOverlay';
export type {
  DictionaryPronunciationOverlayProps,
  PronunciationDisplayEntry,
} from '../DictionaryPronunciationOverlay';

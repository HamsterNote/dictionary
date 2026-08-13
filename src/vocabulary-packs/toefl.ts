import snapshot from '../data/ecdict-toefl.tsv?raw';
import { TOEFL_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const toeflVocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  TOEFL_VOCABULARY_METADATA,
);

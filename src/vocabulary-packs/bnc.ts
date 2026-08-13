import snapshot from '../data/ecdict-bnc.tsv?raw';
import { BNC_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const bncVocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  BNC_VOCABULARY_METADATA,
);

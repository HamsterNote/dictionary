import snapshot from '../data/ecdict-gk.tsv?raw';
import { GK_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const gkVocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  GK_VOCABULARY_METADATA,
);

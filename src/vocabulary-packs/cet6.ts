import snapshot from '../data/ecdict-cet6.tsv?raw';
import { CET6_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const cet6VocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  CET6_VOCABULARY_METADATA,
);

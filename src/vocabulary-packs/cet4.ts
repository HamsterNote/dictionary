import snapshot from '../data/ecdict-cet4.tsv?raw';
import { CET4_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const cet4VocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  CET4_VOCABULARY_METADATA,
);

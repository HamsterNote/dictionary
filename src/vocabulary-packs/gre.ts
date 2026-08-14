import snapshot from '../data/ecdict-gre.tsv?raw';
import { GRE_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const greVocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  GRE_VOCABULARY_METADATA,
);

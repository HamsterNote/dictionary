import snapshot from '../data/ecdict-ky.tsv?raw';
import { KY_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const kyVocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  KY_VOCABULARY_METADATA,
);

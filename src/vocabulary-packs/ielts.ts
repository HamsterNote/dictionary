import snapshot from '../data/ecdict-ielts.tsv?raw';
import { IELTS_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const ieltsVocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  IELTS_VOCABULARY_METADATA,
);

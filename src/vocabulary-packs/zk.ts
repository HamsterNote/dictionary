import snapshot from '../data/ecdict-zk.tsv?raw';
import { ZK_VOCABULARY_METADATA } from '../data/ecdictManifest';
import { createEnglishChineseVocabularyPack } from '../englishChineseVocabularyPack';

export const zkVocabularyPack = createEnglishChineseVocabularyPack(
  snapshot,
  ZK_VOCABULARY_METADATA,
);

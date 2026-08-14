import { createChineseDictionaryPack } from '../chineseDictionaryPack';
import snapshot from '../data/chinese-dictionary.tsv?raw';
import { CHINESE_DICTIONARY_DICTIONARY_METADATA } from '../data/chineseDictionaryManifest';

export const chineseDictionaryPack = createChineseDictionaryPack(
  snapshot,
  CHINESE_DICTIONARY_DICTIONARY_METADATA,
);

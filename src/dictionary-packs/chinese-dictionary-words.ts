import { createChineseDictionaryPack } from '../chineseDictionaryPack';
import snapshot from '../data/chinese-dictionary-words.tsv?raw';
import { CHINESE_DICTIONARY_WORDS_DICTIONARY_METADATA } from '../data/chineseDictionaryManifest';

export const chineseDictionaryWordsDictionaryPack = createChineseDictionaryPack(
  snapshot,
  CHINESE_DICTIONARY_WORDS_DICTIONARY_METADATA,
);

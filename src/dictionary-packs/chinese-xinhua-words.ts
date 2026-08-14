import { createChineseDictionaryPack } from '../chineseDictionaryPack';
import snapshot from '../data/chinese-xinhua-words.tsv?raw';
import { CHINESE_XINHUA_WORDS_DICTIONARY_METADATA } from '../data/chineseDictionaryManifest';

export const chineseXinhuaWordsDictionaryPack = createChineseDictionaryPack(
  snapshot,
  CHINESE_XINHUA_WORDS_DICTIONARY_METADATA,
);

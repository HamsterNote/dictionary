import { createChineseDictionaryPack } from '../chineseDictionaryPack';
import snapshot from '../data/chinese-xinhua.tsv?raw';
import { CHINESE_XINHUA_DICTIONARY_METADATA } from '../data/chineseDictionaryManifest';

export const chineseXinhuaDictionaryPack = createChineseDictionaryPack(
  snapshot,
  CHINESE_XINHUA_DICTIONARY_METADATA,
);

import type { OfflineDictionaryResourceStore } from './offline-resources/types';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import {
  createChineseDictionaryDetail,
  getDetail,
  search,
  type DictionaryDataDetail,
  type DictionaryDetailOptions,
} from './dictionaryData';
import { createChineseEntrySummary, resolveChineseEntry } from './lookupChinese';
import { resolveEnglishChineseEntry } from './lookupEnglishChinese';

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

export interface DictionaryProvider {
  readonly search: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<readonly DictionaryEntrySummary[]>;
  readonly getDetail: (
    word: string,
    signal?: AbortSignal,
  ) => Promise<DictionaryDataDetail | undefined>;
  readonly resolveEntry: (
    word: string,
    signal?: AbortSignal,
  ) => Promise<DictionaryEntrySummary | undefined>;
}

export interface DictionaryProviderOptions extends DictionaryDetailOptions {
  readonly limit?: number;
  readonly offlineResources?: OfflineDictionaryResourceStore;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export function createDictionaryProvider(
  options: DictionaryProviderOptions = {},
): DictionaryProvider {
  const offlineResources = options.offlineResources;
  const isChineseWord = (word: string) =>
    options.language === 'chinese' ||
    (options.language !== 'english' && HAN_CHARACTER_PATTERN.test(word));

  return {
    async search(query, signal) {
      throwIfAborted(signal);
      if (offlineResources && isChineseWord(query)) {
        const result = await offlineResources.suggestChineseEntries(query, options.limit ?? 18);
        throwIfAborted(signal);
        return result;
      }
      return search(query, options);
    },
    async getDetail(word, signal) {
      throwIfAborted(signal);
      if (offlineResources && isChineseWord(word)) {
        const result = await offlineResources.lookupChinese(word);
        throwIfAborted(signal);
        return createChineseDictionaryDetail(result);
      }
      if (offlineResources && options.language !== 'chinese') {
        const [englishSynonymPacks, englishRootPacks] = await Promise.all([
          offlineResources.getSynonymPacks(word),
          offlineResources.getRootPacks(word),
        ]);
        throwIfAborted(signal);
        return getDetail(word, { ...options, englishRootPacks, englishSynonymPacks });
      }
      return getDetail(word, options);
    },
    async resolveEntry(word, signal) {
      throwIfAborted(signal);
      if (offlineResources && isChineseWord(word)) {
        const result = createChineseEntrySummary(await offlineResources.lookupChinese(word));
        throwIfAborted(signal);
        return result;
      }
      if (isChineseWord(word)) {
        return resolveChineseEntry(word, options.chineseDictionaryPacks ?? []);
      }
      return resolveEnglishChineseEntry(word, options.englishVocabularyPacks ?? [], {
        forms: options.englishInflectionFormsPacks ?? [],
        index: options.englishInflectionIndexPacks ?? [],
      });
    },
  };
}

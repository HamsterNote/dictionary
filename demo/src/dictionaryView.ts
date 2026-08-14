import {
  type ChineseDictionaryPack,
  countChineseEntries,
  countEnglishChineseEntries,
  type DictionaryEntrySummary,
  type DictionaryMeaning,
  type DictionarySource,
  type EnglishChineseVocabularyPack,
  type EnglishExampleSentencePack,
  type EnglishInflectionFormsPack,
  type EnglishInflectionIndexPack,
  type EnglishRootPack,
  type EnglishSynonymPack,
  createEnglishResultSources,
  getChineseSourceHref,
  lookupChinese,
  lookupEnglishChinese,
  suggestChineseEntries,
  suggestEnglishChineseEntries,
} from '../../src';

export interface DictionaryView {
  readonly emptyMessage: string | undefined;
  readonly meanings: readonly DictionaryMeaning[];
  readonly phonetic: string | undefined;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly sources: readonly DictionarySource[];
  readonly suggestions: readonly DictionaryEntrySummary[];
  readonly totalEntries: number;
  readonly word: string;
}

interface CreateDictionaryViewOptions {
  readonly chineseDictionaryPacks: readonly ChineseDictionaryPack[];
  readonly committedQuery: string;
  readonly englishExampleSentencePacks: readonly EnglishExampleSentencePack[];
  readonly englishInflectionFormsPacks: readonly EnglishInflectionFormsPack[];
  readonly englishInflectionIndexPacks: readonly EnglishInflectionIndexPack[];
  readonly englishRootPacks: readonly EnglishRootPack[];
  readonly englishSynonymPacks: readonly EnglishSynonymPack[];
  readonly englishVocabularyPacks: readonly EnglishChineseVocabularyPack[];
  readonly isChineseQuery: boolean;
  readonly isChineseSearch: boolean;
  readonly query: string;
}

export function createDictionaryView({
  chineseDictionaryPacks,
  committedQuery,
  englishExampleSentencePacks,
  englishInflectionFormsPacks,
  englishInflectionIndexPacks,
  englishRootPacks,
  englishSynonymPacks,
  englishVocabularyPacks,
  isChineseQuery,
  isChineseSearch,
  query,
}: CreateDictionaryViewOptions): DictionaryView {
  if (isChineseQuery) {
    const result = lookupChinese(committedQuery, chineseDictionaryPacks);
    return {
      emptyMessage:
        chineseDictionaryPacks.length === 0
          ? '请先加载一个中文词库，再查询汉字或成语。'
          : '没有找到精确释义，请换一个汉字或成语再试。',
      meanings: result.status === 'found' ? result.meanings : [],
      phonetic: result.status === 'found' ? result.phonetic : undefined,
      searchLabel: isChineseSearch ? '搜索中文汉字或成语' : '搜索英文单词',
      searchPlaceholder: '请输入字或词',
      sources:
        result.status === 'found'
          ? [
              {
                ...(getChineseSourceHref(result.sourceId) === undefined
                  ? {}
                  : { href: getChineseSourceHref(result.sourceId) }),
                id: result.sourceId,
                label: result.sourceLabel,
                meanings: result.meanings,
              },
            ]
          : [],
      suggestions: isChineseSearch
        ? suggestChineseEntries(query, chineseDictionaryPacks)
        : suggestEnglishChineseEntries(query, englishVocabularyPacks, {
            inflectionIndexPacks: englishInflectionIndexPacks,
          }),
      totalEntries: countChineseEntries(chineseDictionaryPacks),
      word: result.status === 'found' ? result.word : committedQuery || '仓鼠词典',
    };
  }

  const result = lookupEnglishChinese(
    committedQuery,
    englishVocabularyPacks,
    englishExampleSentencePacks,
    englishSynonymPacks,
    englishRootPacks,
    { forms: englishInflectionFormsPacks, index: englishInflectionIndexPacks },
  );
  return {
    emptyMessage: undefined,
    meanings: result.status === 'found' ? result.meanings : [],
    phonetic: result.status === 'found' ? result.phonetic : undefined,
    searchLabel: isChineseSearch ? '搜索中文汉字或成语' : '搜索英文单词',
    searchPlaceholder: '请输入字或词',
    sources: createEnglishResultSources(result),
    suggestions: isChineseSearch
      ? suggestChineseEntries(query, chineseDictionaryPacks)
      : suggestEnglishChineseEntries(query, englishVocabularyPacks, {
          inflectionIndexPacks: englishInflectionIndexPacks,
        }),
    totalEntries: countEnglishChineseEntries(englishVocabularyPacks),
    word: result.status === 'found' ? result.word : committedQuery || '仓鼠词典',
  };
}

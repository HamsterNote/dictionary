import { useMemo } from 'react';
import {
  type DictionaryGetDetail,
  type DictionarySearch,
  search as defaultSearch,
  getDetail as getDefaultDetail,
} from './dictionaryData';
import type { EnglishChineseVocabularyPack } from './englishChineseVocabularyPack';
import type { EnglishExampleSentencePack } from './englishExampleSentencePack';
import type {
  EnglishInflectionFormsPack,
  EnglishInflectionIndexPack,
} from './englishInflectionPack';
import type { EnglishRootPack } from './englishRootPack';
import type { EnglishSynonymPack } from './englishSynonymPack';
import { HamsterDictionary, type HamsterDictionaryProps } from './HamsterDictionary';
import { resolveEnglishChineseEntry } from './lookupEnglishChinese';
import { useDictionaryNavigation } from './useDictionaryNavigation';

const EMPTY_VOCABULARY_PACKS: readonly EnglishChineseVocabularyPack[] = [];
const EMPTY_EXAMPLE_SENTENCE_PACKS: readonly EnglishExampleSentencePack[] = [];
const EMPTY_SYNONYM_PACKS: readonly EnglishSynonymPack[] = [];
const EMPTY_ROOT_PACKS: readonly EnglishRootPack[] = [];
const EMPTY_INFLECTION_FORMS_PACKS: readonly EnglishInflectionFormsPack[] = [];
const EMPTY_INFLECTION_INDEX_PACKS: readonly EnglishInflectionIndexPack[] = [];

// 说明：resolveEntry 与 phonetic 均直接继承 HamsterDictionaryProps，避免重复 Omit / 重声明。
// 宿主显式传入的 phonetic（包括空字符串）优先于 detail 中的音标。
export interface EnglishChineseDictionaryPopoverProps extends Omit<
  HamsterDictionaryProps,
  'meanings' | 'sources' | 'suggestions' | 'word'
> {
  readonly exampleSentencePacks?: readonly EnglishExampleSentencePack[];
  readonly inflectionFormsPacks?: readonly EnglishInflectionFormsPack[];
  readonly inflectionIndexPacks?: readonly EnglishInflectionIndexPack[];
  readonly rootPacks?: readonly EnglishRootPack[];
  readonly sources?: HamsterDictionaryProps['sources'];
  readonly synonymPacks?: readonly EnglishSynonymPack[];
  readonly vocabularyPacks?: readonly EnglishChineseVocabularyPack[];
}

export function EnglishChineseDictionaryPopover({
  exampleSentencePacks = EMPTY_EXAMPLE_SENTENCE_PACKS,
  inflectionFormsPacks = EMPTY_INFLECTION_FORMS_PACKS,
  inflectionIndexPacks = EMPTY_INFLECTION_INDEX_PACKS,
  onQueryChange,
  onSearch,
  query = '',
  rootPacks = EMPTY_ROOT_PACKS,
  sources,
  synonymPacks = EMPTY_SYNONYM_PACKS,
  vocabularyPacks = EMPTY_VOCABULARY_PACKS,
  ...props
}: EnglishChineseDictionaryPopoverProps) {
  const navigation = useDictionaryNavigation({ onQueryChange, onSearch, query });
  const providedSearch = props.search;
  const providedGetDetail = props.getDetail;
  const providedResolveEntry = props.resolveEntry;
  const search = useMemo<DictionarySearch>(
    () =>
      providedSearch ??
      ((word) =>
        defaultSearch(word, {
          englishInflectionIndexPacks: inflectionIndexPacks,
          englishVocabularyPacks: vocabularyPacks,
        })),
    [inflectionIndexPacks, providedSearch, vocabularyPacks],
  );
  const resolveEntry = useMemo(
    () =>
      providedResolveEntry ??
      ((word) =>
        resolveEnglishChineseEntry(word, vocabularyPacks, {
          forms: inflectionFormsPacks,
          index: inflectionIndexPacks,
        })),
    [inflectionFormsPacks, inflectionIndexPacks, providedResolveEntry, vocabularyPacks],
  );
  const getDetail = useMemo<DictionaryGetDetail>(
    () =>
      providedGetDetail ??
      ((word) =>
        getDefaultDetail(word, {
          englishExampleSentencePacks: exampleSentencePacks,
          englishInflectionFormsPacks: inflectionFormsPacks,
          englishInflectionIndexPacks: inflectionIndexPacks,
          englishRootPacks: rootPacks,
          englishSynonymPacks: synonymPacks,
          englishVocabularyPacks: vocabularyPacks,
        })),
    [
      exampleSentencePacks,
      inflectionFormsPacks,
      inflectionIndexPacks,
      providedGetDetail,
      rootPacks,
      synonymPacks,
      vocabularyPacks,
    ],
  );
  const detail = useMemo(
    () => getDetail(navigation.committedQuery),
    [getDetail, navigation.committedQuery],
  );
  const phonetic = props.phonetic ?? detail?.phonetic;

  return (
    <HamsterDictionary
      {...props}
      {...(navigation.canGoBack ? { onBack: navigation.goBack } : {})}
      {...(navigation.canGoForward ? { onForward: navigation.goForward } : {})}
      getDetail={getDetail}
      {...(onQueryChange ? { onQueryChange: navigation.onQueryChange } : {})}
      onSearch={navigation.search}
      // 显式 phonetic 放在 ...props 展开之后：宿主显式值优先；未显式提供时用已取回的 detail 音标，
      // 从而让内容 hook 不再为音标重复调用 getDetail。使用 ?? 以尊重显式传入的空字符串。
      {...(phonetic === undefined ? {} : { phonetic })}
      query={query}
      resolveEntry={resolveEntry}
      search={search}
      {...(sources ? { sources } : {})}
      showGuide={navigation.committedQuery.length === 0}
      word={detail?.word ?? (navigation.committedQuery || '仓鼠词典')}
    />
  );
}

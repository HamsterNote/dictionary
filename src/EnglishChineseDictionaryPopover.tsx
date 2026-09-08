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
import { useDictionaryNavigation } from './useDictionaryNavigation';

const EMPTY_VOCABULARY_PACKS: readonly EnglishChineseVocabularyPack[] = [];
const EMPTY_EXAMPLE_SENTENCE_PACKS: readonly EnglishExampleSentencePack[] = [];
const EMPTY_SYNONYM_PACKS: readonly EnglishSynonymPack[] = [];
const EMPTY_ROOT_PACKS: readonly EnglishRootPack[] = [];
const EMPTY_INFLECTION_FORMS_PACKS: readonly EnglishInflectionFormsPack[] = [];
const EMPTY_INFLECTION_INDEX_PACKS: readonly EnglishInflectionIndexPack[] = [];

export interface EnglishChineseDictionaryPopoverProps extends Omit<
  HamsterDictionaryProps,
  'meanings' | 'phonetic' | 'sources' | 'suggestions' | 'word'
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

  return (
    <HamsterDictionary
      {...props}
      {...(navigation.canGoBack ? { onBack: navigation.goBack } : {})}
      {...(navigation.canGoForward ? { onForward: navigation.goForward } : {})}
      getDetail={getDetail}
      {...(onQueryChange ? { onQueryChange: navigation.onQueryChange } : {})}
      onSearch={navigation.search}
      query={query}
      search={search}
      {...(sources ? { sources } : {})}
      showGuide={navigation.committedQuery.length === 0}
      word={detail?.word ?? (navigation.committedQuery || '仓鼠词典')}
    />
  );
}

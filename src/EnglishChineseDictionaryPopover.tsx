import { useMemo } from 'react';
import { HamsterDictionary, type HamsterDictionaryProps } from './HamsterDictionary';
import type { EnglishChineseVocabularyPack } from './englishChineseVocabularyPack';
import type { EnglishExampleSentencePack } from './englishExampleSentencePack';
import type {
  EnglishInflectionFormsPack,
  EnglishInflectionIndexPack,
} from './englishInflectionPack';
import { createEnglishResultSources } from './englishResultSources';
import type { EnglishSynonymPack } from './englishSynonymPack';
import type { EnglishRootPack } from './englishRootPack';
import {
  findEnglishChineseEntryLabels,
  lookupEnglishChinese,
  resolveEnglishChineseEntry,
  suggestEnglishChineseEntries,
} from './lookupEnglishChinese';
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
  const result = useMemo(
    () =>
      lookupEnglishChinese(
        navigation.committedQuery,
        vocabularyPacks,
        exampleSentencePacks,
        synonymPacks,
        rootPacks,
        { forms: inflectionFormsPacks, index: inflectionIndexPacks },
      ),
    [
      exampleSentencePacks,
      inflectionFormsPacks,
      inflectionIndexPacks,
      navigation.committedQuery,
      rootPacks,
      synonymPacks,
      vocabularyPacks,
    ],
  );
  const suggestions = useMemo(
    () =>
      suggestEnglishChineseEntries(query, vocabularyPacks, {
        inflectionIndexPacks,
      }),
    [inflectionIndexPacks, query, vocabularyPacks],
  );
  const matchingLabels = useMemo(
    () => findEnglishChineseEntryLabels(navigation.committedQuery, vocabularyPacks),
    [navigation.committedQuery, vocabularyPacks],
  ).join(' + ');
  const resolveEntry = useMemo(
    () => (word: string) =>
      resolveEnglishChineseEntry(word, vocabularyPacks, { index: inflectionIndexPacks }),
    [inflectionIndexPacks, vocabularyPacks],
  );
  const resultSources = createEnglishResultSources(result, matchingLabels);

  return (
    <HamsterDictionary
      {...props}
      {...(navigation.canGoBack ? { onBack: navigation.goBack } : {})}
      {...(navigation.canGoForward ? { onForward: navigation.goForward } : {})}
      meanings={result.status === 'found' ? result.meanings : []}
      {...(onQueryChange ? { onQueryChange } : {})}
      onSearch={navigation.search}
      {...(result.status === 'found' && result.phonetic ? { phonetic: result.phonetic } : {})}
      query={query}
      resolveEntry={resolveEntry}
      sources={sources ?? resultSources}
      showGuide={navigation.committedQuery.length === 0}
      suggestions={suggestions}
      word={result.status === 'found' ? result.word : navigation.committedQuery || '仓鼠词典'}
    />
  );
}

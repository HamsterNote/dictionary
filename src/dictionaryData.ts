import type { ChineseDictionaryPack } from './chineseDictionaryPack';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { getChineseSourceHref } from './dictionarySources';
import type { EnglishChineseVocabularyPack } from './englishChineseVocabularyPack';
import type { EnglishExampleSentencePack } from './englishExampleSentencePack';
import type {
  EnglishInflectionFormsPack,
  EnglishInflectionIndexPack,
} from './englishInflectionPack';
import { createEnglishResultSources } from './englishResultSources';
import type { EnglishRootPack } from './englishRootPack';
import type { EnglishSynonymPack } from './englishSynonymPack';
import { lookupChinese } from './lookupChinese';
import { findEnglishChineseEntryLabels, lookupEnglishChinese } from './lookupEnglishChinese';
import {
  type DictionaryCandidateSearchOptions,
  searchDictionaryCandidates,
} from './searchDictionaryCandidates';

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

export interface DictionaryMeaning {
  readonly definition: string;
  readonly example?: string;
  readonly examples?: readonly string[];
  readonly id: string;
  readonly partOfSpeech?: string;
}

export interface DictionarySource {
  readonly examples?: readonly string[];
  readonly heading?: string;
  readonly href?: string | undefined;
  readonly id: string;
  readonly label: string;
  readonly meanings: readonly DictionaryMeaning[];
}

export interface DictionaryDetail {
  readonly phonetic?: string;
  readonly sources: readonly DictionarySource[];
  readonly word: string;
}

export interface DictionaryDetailOptions {
  readonly chineseDictionaryPacks?: readonly ChineseDictionaryPack[];
  readonly englishExampleSentencePacks?: readonly EnglishExampleSentencePack[];
  readonly englishInflectionFormsPacks?: readonly EnglishInflectionFormsPack[];
  readonly englishInflectionIndexPacks?: readonly EnglishInflectionIndexPack[];
  readonly englishRootPacks?: readonly EnglishRootPack[];
  readonly englishSynonymPacks?: readonly EnglishSynonymPack[];
  readonly englishVocabularyPacks?: readonly EnglishChineseVocabularyPack[];
}

export type DictionarySearch = (query: string) => readonly DictionaryEntrySummary[];
export type DictionaryGetDetail = (word: string) => DictionaryDetail | undefined;

export function search(
  query: string,
  options: DictionaryCandidateSearchOptions = {},
): readonly DictionaryEntrySummary[] {
  return searchDictionaryCandidates(query, options);
}

export function getDetail(
  word: string,
  options: DictionaryDetailOptions = {},
): DictionaryDetail | undefined {
  if (HAN_CHARACTER_PATTERN.test(word)) {
    const result = lookupChinese(word, options.chineseDictionaryPacks ?? []);
    if (result.status === 'not-found') return undefined;
    const href = getChineseSourceHref(result.sourceId);
    return {
      ...(result.phonetic ? { phonetic: result.phonetic } : {}),
      sources: [
        {
          ...(href === undefined ? {} : { href }),
          id: result.sourceId,
          label: result.sourceLabel,
          meanings: result.meanings,
        },
      ],
      word: result.word,
    };
  }

  const vocabularyPacks = options.englishVocabularyPacks ?? [];
  const result = lookupEnglishChinese(
    word,
    vocabularyPacks,
    options.englishExampleSentencePacks ?? [],
    options.englishSynonymPacks ?? [],
    options.englishRootPacks ?? [],
    {
      forms: options.englishInflectionFormsPacks ?? [],
      index: options.englishInflectionIndexPacks ?? [],
    },
  );
  if (result.status === 'not-found') return undefined;
  return {
    ...(result.phonetic ? { phonetic: result.phonetic } : {}),
    sources: createEnglishResultSources(
      result,
      findEnglishChineseEntryLabels(word, vocabularyPacks).join(' + '),
    ),
    word: result.word,
  };
}

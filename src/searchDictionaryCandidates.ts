import type { ChineseDictionaryPack } from './chineseDictionaryPack';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import type { EnglishChineseVocabularyPack } from './englishChineseVocabularyPack';
import type { EnglishInflectionIndexPack } from './englishInflectionPack';
import { suggestChineseEntries } from './lookupChinese';
import { suggestEnglishChineseEntries } from './lookupEnglishChinese';

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

export type DictionaryLanguage = 'auto' | 'chinese' | 'english';

export interface DictionaryCandidateSearchOptions {
  readonly chineseDictionaryPacks?: readonly ChineseDictionaryPack[];
  readonly englishInflectionIndexPacks?: readonly EnglishInflectionIndexPack[];
  readonly englishVocabularyPacks?: readonly EnglishChineseVocabularyPack[];
  readonly language?: DictionaryLanguage;
  readonly limit?: number;
}

export function searchDictionaryCandidates(
  query: string,
  options: DictionaryCandidateSearchOptions = {},
): readonly DictionaryEntrySummary[] {
  const normalizedQuery = query.trim().normalize('NFKC');
  if (normalizedQuery.length === 0) return [];

  const useChinese =
    options.language === 'chinese' ||
    (options.language !== 'english' && HAN_CHARACTER_PATTERN.test(normalizedQuery));
  if (useChinese) {
    return suggestChineseEntries(
      normalizedQuery,
      options.chineseDictionaryPacks ?? [],
      options.limit ?? 18,
    );
  }

  return suggestEnglishChineseEntries(normalizedQuery, options.englishVocabularyPacks ?? [], {
    ...(options.englishInflectionIndexPacks === undefined
      ? {}
      : { inflectionIndexPacks: options.englishInflectionIndexPacks }),
    limit: options.limit ?? 6,
  });
}

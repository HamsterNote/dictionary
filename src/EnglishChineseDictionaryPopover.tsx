import { useMemo } from 'react';
import { DictionaryPopover, type DictionaryPopoverProps } from './DictionaryPopover';
import type { EnglishChineseVocabularyPack } from './englishChineseVocabularyPack';
import {
  countEnglishChineseEntries,
  findEnglishChineseEntryLabels,
  lookupEnglishChinese,
  suggestEnglishChinese,
} from './lookupEnglishChinese';

const EMPTY_VOCABULARY_PACKS: readonly EnglishChineseVocabularyPack[] = [];

export interface EnglishChineseDictionaryPopoverProps extends Omit<
  DictionaryPopoverProps,
  'meanings' | 'phonetic' | 'source' | 'suggestions' | 'word'
> {
  readonly source?: DictionaryPopoverProps['source'];
  readonly vocabularyPacks?: readonly EnglishChineseVocabularyPack[];
}

export function EnglishChineseDictionaryPopover({
  query = '',
  source,
  vocabularyPacks = EMPTY_VOCABULARY_PACKS,
  ...props
}: EnglishChineseDictionaryPopoverProps) {
  const result = useMemo(
    () => lookupEnglishChinese(query, vocabularyPacks),
    [query, vocabularyPacks],
  );
  const suggestions = useMemo(
    () => suggestEnglishChinese(query, vocabularyPacks),
    [query, vocabularyPacks],
  );
  const activeEntryCount = useMemo(
    () => countEnglishChineseEntries(vocabularyPacks),
    [vocabularyPacks],
  );
  const matchingLabels = useMemo(
    () => findEnglishChineseEntryLabels(query, vocabularyPacks),
    [query, vocabularyPacks],
  ).join(' + ');

  return (
    <DictionaryPopover
      {...props}
      meanings={result.status === 'found' ? result.meanings : []}
      {...(result.status === 'found' && result.phonetic ? { phonetic: result.phonetic } : {})}
      query={query}
      source={
        source ?? (
          <>
            ECDICT{matchingLabels ? ` · 命中：${matchingLabels}` : ''} ·{' '}
            <span className="dictionary-popover__nowrap">
              {activeEntryCount.toLocaleString('zh-CN')} 个唯一词头
            </span>
          </>
        )
      }
      suggestions={suggestions}
      word={result.status === 'found' ? result.word : query.trim() || '英汉词典'}
    />
  );
}

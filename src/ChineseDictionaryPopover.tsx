import { useMemo } from 'react';
import type { ChineseDictionaryPack } from './chineseDictionaryPack';
import { HamsterDictionary, type HamsterDictionaryProps } from './HamsterDictionary';
import { getChineseSourceHref } from './dictionarySources';
import { lookupChinese, resolveChineseEntry, suggestChineseEntries } from './lookupChinese';
import { useDictionaryNavigation } from './useDictionaryNavigation';

const EMPTY_DICTIONARY_PACKS: readonly ChineseDictionaryPack[] = [];

export interface ChineseDictionaryPopoverProps extends Omit<
  HamsterDictionaryProps,
  'meanings' | 'phonetic' | 'sources' | 'suggestions' | 'word'
> {
  readonly dictionaryPacks?: readonly ChineseDictionaryPack[];
  readonly sources?: HamsterDictionaryProps['sources'];
}

export function ChineseDictionaryPopover({
  dictionaryPacks = EMPTY_DICTIONARY_PACKS,
  emptyMessage,
  onQueryChange,
  onSearch,
  query = '',
  searchLabel = '搜索中文汉字或成语',
  searchPlaceholder = '请输入字或词',
  sources,
  ...props
}: ChineseDictionaryPopoverProps) {
  const navigation = useDictionaryNavigation({ onQueryChange, onSearch, query });
  const result = useMemo(
    () => lookupChinese(navigation.committedQuery, dictionaryPacks),
    [dictionaryPacks, navigation.committedQuery],
  );
  const suggestions = useMemo(
    () => suggestChineseEntries(query, dictionaryPacks),
    [dictionaryPacks, query],
  );
  const resolveEntry = useMemo(
    () => (word: string) => resolveChineseEntry(word, dictionaryPacks),
    [dictionaryPacks],
  );

  return (
    <HamsterDictionary
      {...props}
      {...(navigation.canGoBack ? { onBack: navigation.goBack } : {})}
      {...(navigation.canGoForward ? { onForward: navigation.goForward } : {})}
      emptyMessage={
        emptyMessage ??
        (dictionaryPacks.length === 0
          ? '请先加载一个中文词库，再查询汉字或成语。'
          : '没有找到精确释义，请换一个汉字或成语再试。')
      }
      meanings={result.status === 'found' ? result.meanings : []}
      {...(onQueryChange ? { onQueryChange } : {})}
      onSearch={navigation.search}
      {...(result.status === 'found' && result.phonetic ? { phonetic: result.phonetic } : {})}
      query={query}
      resolveEntry={resolveEntry}
      searchLabel={searchLabel}
      searchPlaceholder={searchPlaceholder}
      sources={
        sources ??
        (result.status === 'found'
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
          : [])
      }
      showGuide={navigation.committedQuery.length === 0}
      suggestions={suggestions}
      word={result.status === 'found' ? result.word : navigation.committedQuery || '仓鼠词典'}
    />
  );
}

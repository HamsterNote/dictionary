import { useMemo } from 'react';
import type { ChineseDictionaryPack } from './chineseDictionaryPack';
import {
  type DictionaryGetDetail,
  type DictionarySearch,
  search as defaultSearch,
  getDetail as getDefaultDetail,
} from './dictionaryData';
import { HamsterDictionary, type HamsterDictionaryProps } from './HamsterDictionary';
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
  const providedSearch = props.search;
  const providedGetDetail = props.getDetail;
  const search = useMemo<DictionarySearch>(
    () =>
      providedSearch ??
      ((word) => defaultSearch(word, { chineseDictionaryPacks: dictionaryPacks })),
    [dictionaryPacks, providedSearch],
  );
  const getDetail = useMemo<DictionaryGetDetail>(
    () =>
      providedGetDetail ??
      ((word) => getDefaultDetail(word, { chineseDictionaryPacks: dictionaryPacks })),
    [dictionaryPacks, providedGetDetail],
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
      emptyMessage={
        emptyMessage ??
        (dictionaryPacks.length === 0
          ? '请先加载一个中文词库，再查询汉字或成语。'
          : '没有找到精确释义，请换一个汉字或成语再试。')
      }
      getDetail={getDetail}
      {...(onQueryChange ? { onQueryChange: navigation.onQueryChange } : {})}
      onSearch={navigation.search}
      query={query}
      search={search}
      searchLabel={searchLabel}
      searchPlaceholder={searchPlaceholder}
      {...(sources ? { sources } : {})}
      showGuide={navigation.committedQuery.length === 0}
      word={detail?.word ?? (navigation.committedQuery || '仓鼠词典')}
    />
  );
}

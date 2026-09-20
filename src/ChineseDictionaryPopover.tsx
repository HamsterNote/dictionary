import { useMemo } from 'react';
import type { ChineseDictionaryPack } from './chineseDictionaryPack';
import {
  type DictionaryGetDetail,
  type DictionarySearch,
  search as defaultSearch,
  getDetail as getDefaultDetail,
} from './dictionaryData';
import { HamsterDictionary, type HamsterDictionaryProps } from './HamsterDictionary';
import { resolveChineseEntry } from './lookupChinese';
import { useDictionaryNavigation } from './useDictionaryNavigation';

const EMPTY_DICTIONARY_PACKS: readonly ChineseDictionaryPack[] = [];

// 说明：不再 Omit 'phonetic'，改为直接从父 Props 继承并继续透传。
// 宿主显式传入的 phonetic（包括空字符串）优先于 detail 中的音标。
export interface ChineseDictionaryPopoverProps extends Omit<
  HamsterDictionaryProps,
  'meanings' | 'sources' | 'suggestions' | 'word'
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
  const providedResolveEntry = props.resolveEntry;
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
  const resolveEntry = useMemo(
    () => providedResolveEntry ?? ((word: string) => resolveChineseEntry(word, dictionaryPacks)),
    [dictionaryPacks, providedResolveEntry],
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
      emptyMessage={
        emptyMessage ??
        (dictionaryPacks.length === 0
          ? '请先加载一个中文词库，再查询汉字或成语。'
          : '没有找到精确释义，请换一个汉字或成语再试。')
      }
      getDetail={getDetail}
      {...(onQueryChange ? { onQueryChange: navigation.onQueryChange } : {})}
      onSearch={navigation.search}
      // 显式 phonetic 放在 ...props 展开之后：宿主显式值优先；未显式提供时用已取回的 detail 音标，
      // 从而让内容 hook 不再为音标重复调用 getDetail。使用 ?? 以尊重显式传入的空字符串。
      {...(phonetic === undefined ? {} : { phonetic })}
      query={query}
      resolveEntry={resolveEntry}
      search={search}
      searchLabel={searchLabel}
      searchPlaceholder={searchPlaceholder}
      {...(sources ? { sources } : {})}
      showGuide={navigation.committedQuery.length === 0}
      word={detail?.word ?? (navigation.committedQuery || '仓鼠词典')}
    />
  );
}

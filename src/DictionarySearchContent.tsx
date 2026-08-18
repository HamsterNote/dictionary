import type { ReactNode } from 'react';
import { useState } from 'react';
import { DictionaryContent } from './DictionaryContent';
import { DictionarySearch } from './DictionarySearch';
import { DictionaryWordPreview } from './DictionaryWordPreview';
import type {
  DictionaryGetDetail,
  DictionaryMeaning,
  DictionarySearch as DictionarySearchFunction,
  DictionarySource,
} from './dictionaryData';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';

export interface DictionarySearchContentProps {
  readonly emptyMessage?: ReactNode;
  readonly getDetail?: DictionaryGetDetail;
  readonly headingId?: string;
  readonly meanings?: readonly DictionaryMeaning[];
  readonly onQueryChange?: (query: string) => void;
  readonly onSearch?: (query: string) => void;
  readonly phonetic?: string;
  readonly pronounce?: (word: string) => Promise<void>;
  readonly query?: string;
  readonly resolveEntry?: (word: string) => DictionaryEntrySummary | undefined;
  readonly search?: DictionarySearchFunction;
  readonly searchLabel?: string;
  readonly searchPlaceholder?: string;
  readonly showGuide?: boolean;
  readonly sources?: readonly DictionarySource[];
  readonly suggestions?: readonly DictionaryEntrySummary[];
  readonly word: string;
}

export function DictionarySearchContent({
  emptyMessage,
  getDetail,
  headingId,
  meanings,
  onQueryChange,
  onSearch,
  phonetic,
  pronounce,
  query,
  resolveEntry,
  search,
  searchLabel = '搜索英文单词',
  searchPlaceholder = '请输入字或词',
  showGuide = false,
  sources,
  suggestions,
  word,
}: DictionarySearchContentProps) {
  const [preview, setPreview] = useState<
    | {
        readonly anchor: HTMLButtonElement;
        readonly entry: DictionaryEntrySummary;
      }
    | undefined
  >(undefined);
  const resolvedSuggestions = suggestions ?? (query === undefined ? [] : (search?.(query) ?? []));

  return (
    <>
      {query === undefined ? null : (
        <DictionarySearch
          label={searchLabel}
          onQueryChange={onQueryChange}
          onSearch={onSearch}
          placeholder={searchPlaceholder}
          query={query}
          suggestions={resolvedSuggestions}
        />
      )}
      {preview ? (
        <DictionaryWordPreview
          anchor={preview.anchor}
          entry={preview.entry}
          onClose={() => {
            setPreview(undefined);
          }}
          onExpand={(nextWord) => {
            setPreview(undefined);
            onSearch?.(nextWord);
          }}
        />
      ) : null}

      <DictionaryContent
        {...(emptyMessage === undefined ? {} : { emptyMessage })}
        {...(getDetail ? { getDetail } : {})}
        {...(headingId ? { headingId } : {})}
        keyword={word}
        {...(meanings ? { meanings } : {})}
        onOpenPreview={(entry, anchor) => {
          setPreview({ anchor, entry });
        }}
        {...(phonetic ? { phonetic } : {})}
        {...(pronounce ? { pronounce } : {})}
        {...(resolveEntry ? { resolveEntry } : {})}
        {...(search ? { search } : {})}
        showGuide={showGuide}
        {...(sources ? { sources } : {})}
      />
    </>
  );
}

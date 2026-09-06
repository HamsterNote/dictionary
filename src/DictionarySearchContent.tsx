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
import type { DictionaryCorrectionsControl } from './dictionaryCorrections';
import { applyDictionaryCorrectionToSummary } from './dictionaryCorrectionApply';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { useDictionaryCorrections } from './useDictionaryCorrections';

export interface DictionarySearchContentProps {
  readonly corrections?: DictionaryCorrectionsControl;
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
  corrections,
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
        readonly originalWord: string;
      }
    | undefined
  >(undefined);
  const resolvedCorrections = useDictionaryCorrections(corrections);
  const resolvedSuggestions = suggestions ?? (query === undefined ? [] : (search?.(query) ?? []));

  return (
    <>
      {query === undefined ? null : (
        <DictionarySearch
          corrections={resolvedCorrections}
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
          entry={applyDictionaryCorrectionToSummary(preview.entry, resolvedCorrections).summary}
          onClose={() => {
            setPreview(undefined);
          }}
          onExpand={() => {
            setPreview(undefined);
            onSearch?.(preview.originalWord);
          }}
          originalWord={preview.originalWord}
        />
      ) : null}

      <DictionaryContent
        {...(corrections === undefined ? {} : { corrections })}
        {...(emptyMessage === undefined ? {} : { emptyMessage })}
        {...(getDetail ? { getDetail } : {})}
        {...(headingId ? { headingId } : {})}
        keyword={word}
        {...(meanings ? { meanings } : {})}
        onOpenPreview={(entry, anchor) => {
          setPreview({ anchor, entry, originalWord: entry.word });
        }}
        {...(phonetic ? { phonetic } : {})}
        {...(pronounce ? { pronounce } : {})}
        {...(resolveEntry ? { resolveEntry } : {})}
        resolvedCorrections={resolvedCorrections}
        {...(search ? { search } : {})}
        showGuide={showGuide}
        {...(sources ? { sources } : {})}
      />
    </>
  );
}

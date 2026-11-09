import { Button } from '@hamster-note/components/button';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DictionaryContent } from './DictionaryContent';
import { DictionarySearch } from './DictionarySearch';
import { DictionaryWordPreview, type DictionaryWordPreviewStatus } from './DictionaryWordPreview';
import type {
  DictionaryGetDetail,
  DictionaryMeaning,
  DictionarySearch as DictionarySearchFunction,
  DictionarySource,
} from './dictionaryData';
import type { DictionaryCorrectionsControl } from './dictionaryCorrections';
import { applyDictionaryCorrectionToSummary } from './dictionaryCorrectionApply';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import type { DictionaryProvider } from './dictionaryProvider';
import type { PronunciationPlaybackController } from './pronunciation-audio/controller';
import type { DictionaryPronounce } from './dictionaryPronounce';
import { useDictionaryCorrections } from './useDictionaryCorrections';
import { useDictionaryTextResolution } from './useDictionaryTextResolution';

export interface DictionarySearchContentProps {
  readonly corrections?: DictionaryCorrectionsControl;
  readonly emptyMessage?: ReactNode;
  readonly getDetail?: DictionaryGetDetail;
  readonly headingId?: string;
  readonly meanings?: readonly DictionaryMeaning[];
  readonly onQueryChange?: (query: string) => void;
  readonly onSearch?: (query: string) => void;
  readonly phonetic?: string;
  /** 无匹配可信真人录音时调用宿主朗读；有录音时不调用。 */
  readonly pronounce?: DictionaryPronounce;
  readonly pronunciation?: PronunciationPlaybackController;
  readonly provider?: DictionaryProvider;
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

interface PreviewState {
  readonly anchor: HTMLButtonElement;
  readonly contextWord: string;
  readonly entry: DictionaryEntrySummary;
  readonly originalWord: string;
  readonly status: DictionaryWordPreviewStatus;
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
  pronunciation,
  provider,
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
  const [preview, setPreview] = useState<PreviewState | undefined>(undefined);
  const previewSequenceRef = useRef(0);
  const previewAbortRef = useRef<AbortController | undefined>(undefined);
  const resolvedCorrections = useDictionaryCorrections(corrections);
  const resolvedSuggestions = suggestions ?? (query === undefined ? [] : (search?.(query) ?? []));
  const resolutionDetail =
    sources === undefined && meanings === undefined ? getDetail?.(word) : undefined;
  const textResolution = useDictionaryTextResolution({
    meanings,
    provider,
    resolveEntry,
    sources: sources ?? resolutionDetail?.sources,
  });

  const closePreview = useCallback(() => {
    previewSequenceRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = undefined;
    setPreview(undefined);
  }, []);

  useEffect(() => {
    return () => {
      previewSequenceRef.current += 1;
      previewAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    previewSequenceRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = undefined;
  }, [word]);

  const openPreview = useCallback(
    (entry: DictionaryEntrySummary, anchor: HTMLButtonElement) => {
      previewAbortRef.current?.abort();
      const abortController = new AbortController();
      previewAbortRef.current = abortController;
      const sequence = ++previewSequenceRef.current;
      const originalWord = entry.word;
      setPreview({
        anchor,
        contextWord: word,
        entry,
        originalWord,
        status: provider ? 'loading' : 'ready',
      });
      if (!provider) return;
      void provider
        .resolveEntry(originalWord, abortController.signal)
        .then((resolvedEntry) => {
          if (sequence !== previewSequenceRef.current) return;
          setPreview((current) => {
            if (current?.originalWord !== originalWord) return current;
            return resolvedEntry === undefined
              ? { ...current, status: 'not-found' }
              : { ...current, entry: resolvedEntry, status: 'ready' };
          });
        })
        .catch(() => {
          if (abortController.signal.aborted || sequence !== previewSequenceRef.current) return;
          setPreview((current) => (current ? { ...current, status: 'error' } : current));
        });
    },
    [provider, word],
  );

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
      {preview?.contextWord === word ? (
        <DictionaryWordPreview
          anchor={preview.anchor}
          entry={applyDictionaryCorrectionToSummary(preview.entry, resolvedCorrections).summary}
          onClose={closePreview}
          onExpand={() => {
            const originalWord = preview.originalWord;
            closePreview();
            onSearch?.(originalWord);
          }}
          onRetry={() => {
            openPreview(preview.entry, preview.anchor);
          }}
          originalWord={preview.originalWord}
          status={preview.status}
        />
      ) : null}

      {textResolution.status === 'ready' ? null : (
        <div
          className="dictionary-inline-resolution"
          role={textResolution.status === 'error' ? 'alert' : 'status'}
        >
          {textResolution.status === 'error' ? (
            <>
              <span>释义点词暂时不可用，正文仍可阅读。</span>
              <Button ghost size="small" onClick={textResolution.retry}>
                重试点词加载
              </Button>
            </>
          ) : (
            <span>正在准备释义点词…</span>
          )}
        </div>
      )}
      <DictionaryContent
        {...(corrections === undefined ? {} : { corrections })}
        {...(emptyMessage === undefined ? {} : { emptyMessage })}
        {...(getDetail ? { getDetail } : {})}
        {...(headingId ? { headingId } : {})}
        keyword={word}
        {...(meanings ? { meanings } : {})}
        onOpenPreview={openPreview}
        {...(phonetic === undefined ? {} : { phonetic })}
        {...(pronounce ? { pronounce } : {})}
        {...(pronunciation ? { pronunciation } : {})}
        {...(textResolution.resolveEntry ? { resolveEntry: textResolution.resolveEntry } : {})}
        resolvedCorrections={resolvedCorrections}
        {...(search ? { search } : {})}
        showGuide={showGuide}
        {...(sources ? { sources } : {})}
      />
    </>
  );
}

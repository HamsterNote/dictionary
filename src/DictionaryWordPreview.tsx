import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import type { DictionaryDetail } from './dictionaryData';
import { groupDictionaryPreviewMeanings } from './dictionaryPreviewGroups';
import { useDictionaryPreviewLayout } from './useDictionaryPreviewLayout';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { protectCjkLineBreaks } from './protectCjkLineBreaks';
import { formatDictionaryPhonetic } from './formatDictionaryPhonetic';

export type DictionaryWordPreviewStatus = 'error' | 'loading' | 'not-found' | 'ready';

interface DictionaryWordPreviewProps {
  readonly anchor: HTMLElement;
  readonly detail?: DictionaryDetail | undefined;
  readonly onUnavailable?: () => void;
  readonly entry: DictionaryEntrySummary;
  readonly focusOnMount?: boolean;
  readonly onClose: () => void;
  readonly onExpand: (word: string) => void;
  readonly onPointerEnter?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerLeave?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onRetry?: () => void;
  /** 词条纠错前的原始词头；展开与查找始终使用它。 */
  readonly originalWord?: string;
  readonly showExpandButton?: boolean;
  readonly status?: DictionaryWordPreviewStatus;
}

export function DictionaryWordPreview({
  anchor,
  detail,
  onUnavailable,
  entry,
  focusOnMount = true,
  onClose,
  onExpand,
  onPointerEnter,
  onPointerLeave,
  onRetry,
  originalWord,
  showExpandButton = true,
  status = 'ready',
}: DictionaryWordPreviewProps) {
  const headingId = useId();
  const previewRef = useDictionaryPreviewLayout(
    anchor,
    onClose,
    onUnavailable ?? onClose,
    focusOnMount,
  );
  const groups = groupDictionaryPreviewMeanings(detail);
  useEffect(() => {
    const closeOnOutsideInteraction = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor.contains(target) || previewRef.current?.contains(target)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const shouldRestoreAnchorFocus =
        previewRef.current?.contains(document.activeElement) ?? false;
      onClose();
      if (shouldRestoreAnchorFocus) anchor.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [anchor, onClose, previewRef]);

  return createPortal(
    <>
      <Popover
        aria-busy={status === 'loading'}
        aria-labelledby={headingId}
        className="dictionary-word-preview"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        orientation="vertical"
        ref={previewRef}
        style={{ position: 'fixed', visibility: 'hidden', zIndex: 1000 }}
        role="dialog"
        tabIndex={-1}
      >
        <div className="dictionary-word-preview__heading">
          <div>
            <h3 id={headingId}>{detail?.word ?? entry.word}</h3>
            {(detail?.phonetic ?? entry.phonetic) ? (
              <p>
                {formatDictionaryPhonetic(
                  originalWord ?? entry.word,
                  detail?.phonetic ?? entry.phonetic ?? '',
                )}
              </p>
            ) : null}
          </div>
          {showExpandButton ? (
            <Button
              aria-label={`在主窗口打开 ${originalWord ?? entry.word}`}
              className="dictionary-word-preview__expand"
              disabled={!entry.word}
              ghost
              onClick={() => {
                onExpand(originalWord ?? entry.word);
              }}
              size="small"
              title="放大到主窗口"
            >
              <Icon aria-hidden="true" name="fullscreen" />
            </Button>
          ) : null}
        </div>
        <div className="dictionary-word-preview__body">
          {status === 'loading' ? (
            <p className="dictionary-word-preview__definition" role="status">
              正在加载完整释义…
            </p>
          ) : status === 'error' ? (
            <div className="dictionary-word-preview__definition" role="alert">
              <p>释义加载失败，请重试。</p>
              {onRetry ? (
                <Button ghost size="small" onClick={onRetry}>
                  重新加载释义
                </Button>
              ) : null}
            </div>
          ) : null}
          {status === 'ready' && groups.length > 0 ? (
            groups.map((group) => (
              <section className="dictionary-word-preview__group" key={group.partOfSpeech}>
                <h4>{group.partOfSpeech}</h4>
                <ol>
                  {group.meanings.map((meaning, index) => (
                    <li key={`${meaning.sourceId}-${meaning.id}-${String(index)}`}>
                      <div>
                        {typeof meaning.definition === 'string'
                          ? protectCjkLineBreaks(meaning.definition)
                          : meaning.definition}
                      </div>
                      <small>{meaning.sourceLabel}</small>
                    </li>
                  ))}
                </ol>
              </section>
            ))
          ) : entry.definition.trim() ? (
            <div className="dictionary-word-preview__definition">
              <p>
                {status === 'ready' || status === 'not-found' ? '摘要（暂无完整释义）' : '摘要'}
              </p>
              <p>{protectCjkLineBreaks(entry.definition)}</p>
            </div>
          ) : status === 'ready' || status === 'not-found' ? (
            <p>暂无释义</p>
          ) : null}
        </div>
      </Popover>
    </>,
    anchor.ownerDocument.body,
  );
}

import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import { useCallback, useEffect, useId, useRef, useLayoutEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { protectCjkLineBreaks } from './protectCjkLineBreaks';
import { formatDictionaryPhonetic } from './formatDictionaryPhonetic';

export type DictionaryWordPreviewStatus = 'error' | 'loading' | 'not-found' | 'ready';

interface DictionaryWordPreviewProps {
  readonly anchor: HTMLElement;
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
  const [positionAnchor, setPositionAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const marker = positionAnchor;
    if (!marker) return;
    const update = () => {
      const fragments = Array.from(anchor.getClientRects());
      const index = Number(anchor.dataset['previewFragment'] ?? 0);
      const rect =
        fragments[index] ??
        fragments.find((rect) => rect.bottom > 0 && rect.top < window.innerHeight) ??
        anchor.getBoundingClientRect();
      Object.assign(marker.style, {
        left: `${String(rect.x)}px`,
        top: `${String(rect.y)}px`,
        width: `${String(rect.width)}px`,
        height: `${String(rect.height)}px`,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor, positionAnchor]);
  const previewRef = useRef<HTMLDivElement>(null);
  const focusPreview = useCallback(
    (element: HTMLDivElement | null) => {
      previewRef.current = element;
      if (focusOnMount) element?.focus();
    },
    [focusOnMount],
  );

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
  }, [anchor, onClose]);

  return (
    <>
      <span
        aria-hidden="true"
        ref={setPositionAnchor}
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          visibility: 'hidden',
          margin: 0,
          padding: 0,
          border: 0,
        }}
      />
      <Popover
        anchor={positionAnchor ?? anchor}
        anchorOffset={6}
        aria-busy={status === 'loading'}
        aria-labelledby={headingId}
        className="dictionary-word-preview"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        orientation="vertical"
        placement="bottom-start"
        ref={focusPreview}
        role="dialog"
        tabIndex={-1}
        viewportMargin={8}
      >
        <div className="dictionary-word-preview__heading">
          <div>
            <h3 id={headingId}>{entry.word}</h3>
            {entry.phonetic ? (
              <p>{formatDictionaryPhonetic(originalWord ?? entry.word, entry.phonetic)}</p>
            ) : null}
          </div>
          {showExpandButton ? (
            <Button
              aria-label={`在主窗口打开 ${originalWord ?? entry.word}`}
              className="dictionary-word-preview__expand"
              disabled={status !== 'ready'}
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
        {status === 'loading' ? (
          <p className="dictionary-word-preview__definition" role="status">
            正在加载词条摘要…
          </p>
        ) : status === 'error' ? (
          <div className="dictionary-word-preview__definition" role="alert">
            <p>摘要加载失败，请重试。</p>
            {onRetry ? (
              <Button ghost size="small" onClick={onRetry}>
                重新加载摘要
              </Button>
            ) : null}
          </div>
        ) : status === 'not-found' ? (
          <p className="dictionary-word-preview__definition" role="status">
            未找到该词条的摘要。
          </p>
        ) : (
          <p className="dictionary-word-preview__definition">
            {protectCjkLineBreaks(entry.definition)}
          </p>
        )}
      </Popover>
    </>
  );
}

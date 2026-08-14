import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import { useCallback, useEffect, useId, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { protectCjkLineBreaks } from './protectCjkLineBreaks';

interface DictionaryWordPreviewProps {
  readonly anchor: HTMLElement;
  readonly entry: DictionaryEntrySummary;
  readonly focusOnMount?: boolean;
  readonly onClose: () => void;
  readonly onExpand: (word: string) => void;
  readonly onPointerEnter?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerLeave?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly showExpandButton?: boolean;
}

export function DictionaryWordPreview({
  anchor,
  entry,
  focusOnMount = true,
  onClose,
  onExpand,
  onPointerEnter,
  onPointerLeave,
  showExpandButton = true,
}: DictionaryWordPreviewProps) {
  const headingId = useId();
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
      if (shouldRestoreAnchorFocus) anchor.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [anchor, onClose]);

  return (
    <Popover
      anchor={anchor}
      anchorOffset={6}
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
          {entry.phonetic ? <p>{entry.phonetic}</p> : null}
        </div>
        {showExpandButton ? (
          <Button
            aria-label={`在主窗口打开 ${entry.word}`}
            className="dictionary-word-preview__expand"
            ghost
            onClick={() => {
              onExpand(entry.word);
            }}
            size="small"
            title="放大到主窗口"
          >
            <Icon aria-hidden="true" name="fullscreen" />
          </Button>
        ) : null}
      </div>
      <p className="dictionary-word-preview__definition">
        {protectCjkLineBreaks(entry.definition)}
      </p>
    </Popover>
  );
}

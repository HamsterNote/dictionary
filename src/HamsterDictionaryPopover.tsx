import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DictionaryCorrectionsControl } from './dictionaryCorrections';
import type { DictionaryDetail } from './dictionaryData';
import { selectPreviewFragment } from './dictionaryPreviewLayout';
import {
  applyDictionaryCorrectionToDetail,
  applyDictionaryCorrectionToSummary,
} from './dictionaryCorrectionApply';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { DictionaryWordPreview } from './DictionaryWordPreview';
import { useDictionaryCorrections } from './useDictionaryCorrections';

const CLOSE_DELAY_MS = 150;

export interface HamsterDictionaryPopoverProps {
  readonly children: ReactNode;
  /** 词条纠错配置；缺省使用本机 localStorage 持久化。 */
  readonly corrections?: DictionaryCorrectionsControl;
  readonly entry: DictionaryEntrySummary;
  readonly getDetail?: (
    word: string,
    signal?: AbortSignal,
  ) => DictionaryDetail | undefined | Promise<DictionaryDetail | undefined>;
  /** 点击“放大到主窗口”或（悬停模式下）点击触发词时回调，通常用于打开主窗。 */
  readonly onExpand: (word: string) => void;
  /** 是否显示预览中的“放大到主窗口”按钮，默认 true。 */
  readonly showExpandButton?: boolean;
  /** 触发方式：hover 悬停出现、点击出现，默认 hover。 */
  readonly trigger?: 'hover' | 'click';
}

/**
 * 套在文字外面的迷你词典 Popover：悬停或点击触发词即可预览词义，
 * 并可通过展开按钮（或悬停模式下直接点击触发词）打开主窗。
 */
export function HamsterDictionaryPopover({
  children,
  corrections,
  entry,
  getDetail,
  onExpand,
  showExpandButton = true,
  trigger = 'hover',
}: HamsterDictionaryPopoverProps) {
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [previewNotice, setPreviewNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [detailState, setDetailState] = useState<{
    detail?: DictionaryDetail | undefined;
    word?: string;
    status: 'loading' | 'ready' | 'error';
  }>({ status: 'loading' });
  useEffect(() => {
    if (!isOpen || !getDetail) return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return getDetail(entry.word, controller.signal);
      })
      .then((detail) => {
        if (!controller.signal.aborted)
          setDetailState({ detail, word: entry.word, status: 'ready' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailState({ word: entry.word, status: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [entry.word, getDetail, isOpen, retry]);
  const resolvedCorrections = useDictionaryCorrections(corrections);
  const displayEntry = applyDictionaryCorrectionToSummary(entry, resolvedCorrections).summary;
  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current === undefined) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const open = useCallback(() => {
    cancelScheduledClose();
    setPreviewNotice('');
    if (!isOpen) {
      setDetailState({ status: 'loading' });
      setIsOpen(true);
    }
  }, [cancelScheduledClose, isOpen]);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = undefined;
    }, CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);

  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  const handleExpand = useCallback(
    // 展开始终携带原始词头，纠错拼写只影响预览显示。
    (word: string) => {
      setIsOpen(false);
      onExpand(word);
    },
    [onExpand],
  );

  const handleClick = (): void => {
    if (trigger === 'hover') {
      // 悬停模式下点击触发词 = 直接打开主窗（用原始词头查找）。
      setIsOpen(false);
      onExpand(entry.word);
      return;
    }
    setPreviewNotice('');
    setDetailState({ status: 'loading' });
    setIsOpen((previous) => !previous);
  };
  return (
    <>
      <span role="status" className="dictionary-preview-notice">
        {previewNotice}
      </span>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="hamster-dictionary-popover__trigger"
        onClick={(event) => {
          selectPreviewFragment(
            event.currentTarget,
            event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY },
          );
          handleClick();
        }}
        onPointerEnter={
          trigger === 'hover'
            ? (event) => {
                selectPreviewFragment(event.currentTarget, { x: event.clientX, y: event.clientY });
                open();
              }
            : undefined
        }
        onPointerLeave={trigger === 'hover' ? scheduleClose : undefined}
        ref={setAnchor}
        type="button"
      >
        {children}
      </button>
      {isOpen && anchor !== null ? (
        <DictionaryWordPreview
          anchor={anchor}
          detail={
            detailState.word === entry.word && detailState.detail
              ? applyDictionaryCorrectionToDetail(detailState.detail, resolvedCorrections).detail
              : undefined
          }
          status={
            getDetail ? (detailState.word === entry.word ? detailState.status : 'loading') : 'ready'
          }
          onRetry={() => {
            setDetailState({ status: 'loading' });
            setRetry((value) => value + 1);
          }}
          onUnavailable={() => {
            setIsOpen(false);
            setPreviewNotice('可用空间不足，请调整视图后重新打开词条。');
          }}
          entry={displayEntry}
          focusOnMount={trigger === 'click'}
          onClose={() => {
            setIsOpen(false);
          }}
          onExpand={handleExpand}
          onPointerEnter={cancelScheduledClose}
          onPointerLeave={scheduleClose}
          originalWord={entry.word}
          showExpandButton={showExpandButton}
        />
      ) : null}
    </>
  );
}

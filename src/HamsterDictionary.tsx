import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { useCallback, useId, useRef, useState } from 'react';
import { DictionarySearch } from './DictionarySearch';
import {
  type DictionaryMeaning,
  type DictionarySource,
  DictionarySourceResults,
} from './DictionarySourceResults';
import { DictionaryWordPreview } from './DictionaryWordPreview';
import { PronunciationButton } from './PronunciationButton';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { type DictionaryPosition, usePopoverDrag } from './usePopoverDrag';

export type { DictionaryMeaning, DictionarySource } from './DictionarySourceResults';
export type { DictionaryPosition } from './usePopoverDrag';

export interface HamsterDictionaryProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** 非受控模式下窗口的初始位置；未提供时从 {x:0, y:0} 开始。 */
  readonly defaultPosition?: DictionaryPosition;
  readonly emptyMessage?: ReactNode;
  readonly maxHeight?: number;
  readonly maxWidth?: number;
  readonly meanings: readonly DictionaryMeaning[];
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly onForward?: () => void;
  readonly onPositionChange?: (position: DictionaryPosition) => void;
  readonly onQueryChange?: (query: string) => void;
  readonly onSearch?: (query: string) => void;
  readonly open: boolean;
  readonly phonetic?: string;
  /** 受控位置；提供后窗口位置完全由外部 state 驱动。 */
  readonly position?: DictionaryPosition;
  readonly pronounce?: (word: string) => Promise<void>;
  readonly query?: string;
  readonly ref?: Ref<HTMLElement>;
  readonly searchLabel?: string;
  readonly searchPlaceholder?: string;
  readonly showGuide?: boolean;
  readonly resolveEntry?: (word: string) => DictionaryEntrySummary | undefined;
  readonly sources?: readonly DictionarySource[];
  readonly suggestions?: readonly DictionaryEntrySummary[];
  readonly word: string;
}

export function HamsterDictionary({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
  defaultPosition,
  emptyMessage = (
    <>
      没有找到精确释义。<span className="dictionary-popover__nowrap">请检查拼写</span>
      ，或换一个词再试。
    </>
  ),
  maxHeight,
  maxWidth,
  meanings,
  onBack,
  onClose,
  onForward,
  onPositionChange,
  onQueryChange,
  onSearch,
  open,
  phonetic,
  position,
  pronounce,
  query,
  ref,
  resolveEntry,
  role = 'complementary',
  searchLabel = '搜索英文单词',
  searchPlaceholder = '请输入字或词',
  showGuide = false,
  sources,
  style,
  suggestions = [],
  word,
  ...props
}: HamsterDictionaryProps) {
  const popoverRef = useRef<HTMLElement>(null);
  const callbackRefCleanup = useRef<(() => void) | undefined>(undefined);
  const headingId = useId();
  const [uncontrolledPosition, setUncontrolledPosition] = useState<DictionaryPosition>(
    defaultPosition ?? { x: 0, y: 0 },
  );
  const [preview, setPreview] = useState<
    | {
        readonly anchor: HTMLButtonElement;
        readonly entry: DictionaryEntrySummary;
      }
    | undefined
  >(undefined);
  const isControlled = position !== undefined;
  const currentPosition = position ?? uncontrolledPosition;
  usePopoverDrag({
    enabled: open,
    onPositionChange: (nextPosition) => {
      onPositionChange?.(nextPosition);
      if (!isControlled) setUncontrolledPosition(nextPosition);
    },
    popoverRef,
    position: currentPosition,
  });
  const setPopoverRef = useCallback(
    (element: HTMLElement | null) => {
      popoverRef.current = element;
      if (typeof ref === 'function') {
        const previousCleanup = callbackRefCleanup.current;
        callbackRefCleanup.current = undefined;
        if (previousCleanup) {
          previousCleanup();
          if (element === null) return;
        }
        const cleanup = ref(element);
        if (typeof cleanup === 'function') callbackRefCleanup.current = cleanup;
        return;
      }
      if (ref) ref.current = element;
    },
    [ref],
  );

  if (!open) {
    return null;
  }

  const popoverClassName = className ? `dictionary-popover ${className}` : 'dictionary-popover';
  const popoverStyle = {
    ...style,
    '--dictionary-drag-x': `${String(currentPosition.x)}px`,
    '--dictionary-drag-y': `${String(currentPosition.y)}px`,
    ...(maxWidth === undefined ? {} : { '--dictionary-max-width': `${String(maxWidth)}px` }),
    ...(maxHeight === undefined ? {} : { '--dictionary-max-height': `${String(maxHeight)}px` }),
  } as CSSProperties;

  return (
    <Popover
      {...props}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : headingId)}
      className={popoverClassName}
      orientation="vertical"
      ref={setPopoverRef}
      role={role}
      style={popoverStyle}
    >
      <Button
        aria-label="移动词典窗口；方向键移动，Home 或 Escape 重置位置"
        className="dictionary-popover__drag-handle"
        ghost
        size="small"
        title="按住并拖动词典窗口"
      >
        <Icon aria-hidden="true" name="handle" />
      </Button>
      {onBack ? (
        <Button
          aria-label="返回上一个词条"
          className="dictionary-popover__back"
          ghost
          onClick={onBack}
          size="small"
        >
          <Icon aria-hidden="true" name="arrow-left" />
        </Button>
      ) : null}
      {onForward ? (
        <Button
          aria-label="前进到下一个词条"
          className="dictionary-popover__forward"
          ghost
          onClick={onForward}
          size="small"
        >
          <Icon aria-hidden="true" name="arrow-right" />
        </Button>
      ) : null}
      {onClose ? (
        <Button
          aria-label="关闭词典"
          className="dictionary-popover__close"
          ghost
          onClick={onClose}
          size="small"
        >
          <Icon aria-hidden="true" name="close" />
        </Button>
      ) : null}
      {query === undefined ? null : (
        <DictionarySearch
          label={searchLabel}
          onQueryChange={onQueryChange}
          onSearch={onSearch}
          placeholder={searchPlaceholder}
          query={query}
          suggestions={suggestions}
        />
      )}
      <header className="dictionary-popover__header">
        <div>
          <h2 className="dictionary-popover__word" id={headingId}>
            {word}
          </h2>
          {phonetic ? (
            <div className="dictionary-popover__pronunciation-row">
              <p className="dictionary-popover__phonetic">{phonetic}</p>
              {pronounce ? <PronunciationButton pronounce={pronounce} word={word} /> : null}
            </div>
          ) : null}
        </div>
      </header>

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

      <div className="dictionary-popover__results" id={`${headingId}-results`}>
        <span
          aria-atomic="true"
          aria-live="polite"
          className="dictionary-popover__status"
          role="status"
        >
          {showGuide
            ? '仓鼠词典已就绪'
            : meanings.length === 0
              ? '没有找到释义'
              : `找到 ${String(meanings.length)} 条释义`}
        </span>
        {showGuide ? (
          <div className="dictionary-popover__guide">
            <p>
              输入想了解的词，在候选中
              <span className="dictionary-popover__nowrap">查看读音和基本含义</span>。
            </p>
            <ol>
              <li>点击候选词，或按回车打开完整词条</li>
              <li>点击释义中的可用词汇，快速查看迷你解释</li>
              <li>
                使用放大按钮打开词条，
                <span className="dictionary-popover__nowrap">标题栏可前进或后退</span>
              </li>
            </ol>
          </div>
        ) : meanings.length === 0 ? (
          <p className="dictionary-popover__empty">{emptyMessage}</p>
        ) : (
          <DictionarySourceResults
            onOpenPreview={(entry, anchor) => {
              setPreview({ anchor, entry });
            }}
            resolveEntry={resolveEntry}
            sources={sources ?? [{ id: 'dictionary', label: '词典', meanings }]}
          />
        )}
      </div>
    </Popover>
  );
}

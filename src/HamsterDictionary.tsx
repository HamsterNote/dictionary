import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { useCallback, useId, useRef, useState } from 'react';
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
import { type DictionaryPosition, usePopoverDrag } from './usePopoverDrag';

export type { DictionaryMeaning, DictionarySource } from './dictionaryData';
export type { DictionaryPosition } from './usePopoverDrag';

export interface HamsterDictionaryProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** 非受控模式下窗口的初始位置；未提供时从 {x:0, y:0} 开始。 */
  readonly defaultPosition?: DictionaryPosition;
  readonly emptyMessage?: ReactNode;
  readonly maxHeight?: number;
  readonly maxWidth?: number;
  readonly getDetail?: DictionaryGetDetail;
  readonly meanings?: readonly DictionaryMeaning[];
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
  readonly search?: DictionarySearchFunction;
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
  getDetail,
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
  search,
  showGuide = false,
  sources,
  style,
  suggestions,
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
  const resolvedSuggestions = suggestions ?? (query === undefined ? [] : (search?.(query) ?? []));
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
        emptyMessage={emptyMessage}
        headingId={headingId}
        keyword={word}
        {...(getDetail ? { getDetail } : {})}
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
    </Popover>
  );
}

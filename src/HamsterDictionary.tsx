import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { useCallback, useId, useRef, useState } from 'react';
import {
  DictionarySearchContent,
  type DictionarySearchContentProps,
} from './DictionarySearchContent';
import { type DictionaryPosition, usePopoverDrag } from './usePopoverDrag';

export type { DictionaryMeaning, DictionarySource } from './dictionaryData';
export type { DictionaryPosition } from './usePopoverDrag';

export interface HamsterDictionaryProps
  extends
    Omit<HTMLAttributes<HTMLElement>, 'title'>,
    Omit<DictionarySearchContentProps, 'headingId'> {
  /** 非受控模式下窗口的初始位置；未提供时从 {x:0, y:0} 开始。 */
  readonly defaultPosition?: DictionaryPosition;
  readonly maxHeight?: number;
  readonly maxWidth?: number;
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly onForward?: () => void;
  readonly onPositionChange?: (position: DictionaryPosition) => void;
  readonly open: boolean;
  /** 受控位置；提供后窗口位置完全由外部 state 驱动。 */
  readonly position?: DictionaryPosition;
  readonly ref?: Ref<HTMLElement>;
}

export function HamsterDictionary({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
  corrections,
  defaultPosition,
  emptyMessage,
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
  searchLabel,
  searchPlaceholder,
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
      <DictionarySearchContent
        {...(corrections === undefined ? {} : { corrections })}
        {...(emptyMessage === undefined ? {} : { emptyMessage })}
        {...(getDetail ? { getDetail } : {})}
        headingId={headingId}
        {...(meanings ? { meanings } : {})}
        {...(onQueryChange ? { onQueryChange } : {})}
        {...(onSearch ? { onSearch } : {})}
        {...(phonetic ? { phonetic } : {})}
        {...(pronounce ? { pronounce } : {})}
        {...(query === undefined ? {} : { query })}
        {...(resolveEntry ? { resolveEntry } : {})}
        {...(search ? { search } : {})}
        {...(searchLabel === undefined ? {} : { searchLabel })}
        {...(searchPlaceholder === undefined ? {} : { searchPlaceholder })}
        showGuide={showGuide}
        {...(sources ? { sources } : {})}
        {...(suggestions === undefined ? {} : { suggestions })}
        word={word}
      />
    </Popover>
  );
}

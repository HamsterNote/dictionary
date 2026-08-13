import { Badge } from '@hamster-note/components/badge';
import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { useCallback, useId, useRef } from 'react';
import { DictionarySearch } from './DictionarySearch';
import { usePopoverDrag } from './usePopoverDrag';

const WORD_JOINER = '\u2060';

function protectCjkLineBreaks(definition: ReactNode): ReactNode {
  if (typeof definition !== 'string') return definition;

  // 浏览器默认允许在任意汉字间换行。短词素使用不可见连接符保护，
  // 同时把中文左括号留在前一词之后，避免出现“贬 / 抑”或行首左括号。
  return definition
    .replace(/[\p{Script=Han}]{2,4}/gu, (word) =>
      word.replace(/(?<=\p{Script=Han})(?=\p{Script=Han})/gu, WORD_JOINER),
    )
    .replace(/(?<character>[\p{Script=Han}])（/gu, `$<character>${WORD_JOINER}（`);
}

export interface DictionaryMeaning {
  readonly definition: ReactNode;
  readonly example?: ReactNode;
  readonly id: string;
  readonly partOfSpeech?: string;
}

export interface DictionaryPopoverProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly emptyMessage?: ReactNode;
  readonly meanings: readonly DictionaryMeaning[];
  readonly onClose?: () => void;
  readonly onQueryChange?: (query: string) => void;
  readonly onSearch?: (query: string) => void;
  readonly open: boolean;
  readonly phonetic?: string;
  readonly query?: string;
  readonly ref?: Ref<HTMLElement>;
  readonly searchLabel?: string;
  readonly searchPlaceholder?: string;
  readonly source?: ReactNode;
  readonly suggestions?: readonly string[];
  readonly word: string;
}

export function DictionaryPopover({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
  emptyMessage = (
    <>
      没有找到精确释义。<span className="dictionary-popover__nowrap">请检查拼写</span>
      ，或换一个词再试。
    </>
  ),
  meanings,
  onClose,
  onQueryChange,
  onSearch,
  open,
  phonetic,
  query,
  ref,
  searchLabel = '搜索英文单词',
  searchPlaceholder = '输入英文单词',
  source,
  suggestions = [],
  word,
  ...props
}: DictionaryPopoverProps) {
  const popoverRef = useRef<HTMLElement>(null);
  const headingId = useId();
  usePopoverDrag({ enabled: open, popoverRef });
  const setPopoverRef = useCallback(
    (element: HTMLElement | null) => {
      popoverRef.current = element;
      if (typeof ref === 'function') {
        const cleanup = ref(element);
        return () => {
          popoverRef.current = null;
          if (typeof cleanup === 'function') cleanup();
        };
      }
      if (ref) ref.current = element;
      return () => {
        popoverRef.current = null;
        if (ref) ref.current = null;
      };
    },
    [ref],
  );

  if (!open) {
    return null;
  }

  const popoverClassName = className ? `dictionary-popover ${className}` : 'dictionary-popover';

  return (
    <Popover
      {...props}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : headingId)}
      className={popoverClassName}
      orientation="vertical"
      ref={setPopoverRef}
      role="complementary"
    >
      <span aria-hidden="true" className="dictionary-popover__tab" />
      <Button
        aria-label="移动词典窗口；方向键移动，Home 或 Escape 重置位置"
        className="dictionary-popover__drag-handle"
        ghost
        size="small"
        title="按住并拖动词典窗口"
      >
        <Icon aria-hidden="true" name="handle" />
      </Button>
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
          {phonetic ? <p className="dictionary-popover__phonetic">{phonetic}</p> : null}
        </div>
      </header>

      <div id={`${headingId}-results`}>
        <span
          aria-atomic="true"
          aria-live="polite"
          className="dictionary-popover__status"
          role="status"
        >
          {meanings.length === 0 ? '没有找到释义' : `找到 ${String(meanings.length)} 条释义`}
        </span>
        {meanings.length === 0 ? (
          <p className="dictionary-popover__empty">{emptyMessage}</p>
        ) : (
          <ol className="dictionary-popover__meanings">
            {meanings.map((meaning) => (
              <li className="dictionary-popover__meaning" key={meaning.id}>
                {meaning.partOfSpeech ? (
                  <Badge className="dictionary-popover__part-of-speech" tone="neutral">
                    {meaning.partOfSpeech}
                  </Badge>
                ) : null}
                <div className="dictionary-popover__definition">
                  {protectCjkLineBreaks(meaning.definition)}
                </div>
                {meaning.example ? (
                  <blockquote className="dictionary-popover__example">{meaning.example}</blockquote>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {source ? <footer className="dictionary-popover__source">来源：{source}</footer> : null}
    </Popover>
  );
}

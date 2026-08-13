import type { HTMLAttributes, ReactNode, Ref } from 'react';

export interface DictionaryMeaning {
  readonly definition: ReactNode;
  readonly example?: ReactNode;
  readonly id: string;
  readonly partOfSpeech?: string;
}

export interface DictionaryPopoverProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly meanings: readonly [DictionaryMeaning, ...DictionaryMeaning[]];
  readonly onClose?: () => void;
  readonly open: boolean;
  readonly phonetic?: string;
  readonly ref?: Ref<HTMLElement>;
  readonly source?: ReactNode;
  readonly word: string;
}

export function DictionaryPopover({
  'aria-label': ariaLabel,
  className,
  meanings,
  onClose,
  open,
  phonetic,
  ref,
  source,
  word,
  ...props
}: DictionaryPopoverProps) {
  if (!open) {
    return null;
  }

  const popoverClassName = className ? `dictionary-popover ${className}` : 'dictionary-popover';

  return (
    <aside
      {...props}
      aria-label={ariaLabel ?? `${word} 的词典释义`}
      className={popoverClassName}
      ref={ref}
    >
      <span aria-hidden="true" className="dictionary-popover__tab" />
      <header className="dictionary-popover__header">
        <div>
          <h2 className="dictionary-popover__word">{word}</h2>
          {phonetic ? <p className="dictionary-popover__phonetic">{phonetic}</p> : null}
        </div>
        {onClose ? (
          <button
            aria-label="关闭词典"
            className="dictionary-popover__close"
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </header>

      <ol className="dictionary-popover__meanings">
        {meanings.map((meaning) => (
          <li className="dictionary-popover__meaning" key={meaning.id}>
            {meaning.partOfSpeech ? (
              <span className="dictionary-popover__part-of-speech">{meaning.partOfSpeech}</span>
            ) : null}
            <div className="dictionary-popover__definition">{meaning.definition}</div>
            {meaning.example ? (
              <blockquote className="dictionary-popover__example">{meaning.example}</blockquote>
            ) : null}
          </li>
        ))}
      </ol>

      {source ? <footer className="dictionary-popover__source">来源：{source}</footer> : null}
    </aside>
  );
}

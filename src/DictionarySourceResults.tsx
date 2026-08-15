import { DictionaryInteractiveText } from './DictionaryInteractiveText';
import type { DictionarySource } from './dictionaryData';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { protectCjkLineBreaks } from './protectCjkLineBreaks';

interface DictionarySourceResultsProps {
  readonly onOpenPreview:
    ((entry: DictionaryEntrySummary, anchor: HTMLButtonElement) => void) | undefined;
  readonly resolveEntry: ((word: string) => DictionaryEntrySummary | undefined) | undefined;
  readonly sources: readonly DictionarySource[];
}

function InteractiveContent({
  children,
  onOpenPreview,
  resolveEntry,
}: {
  readonly children: string;
  readonly onOpenPreview:
    ((entry: DictionaryEntrySummary, anchor: HTMLButtonElement) => void) | undefined;
  readonly resolveEntry: ((word: string) => DictionaryEntrySummary | undefined) | undefined;
}) {
  if (!resolveEntry || !onOpenPreview) {
    return protectCjkLineBreaks(children);
  }
  return (
    <DictionaryInteractiveText onOpen={onOpenPreview} resolveEntry={resolveEntry}>
      {children}
    </DictionaryInteractiveText>
  );
}

export function DictionarySourceResults({
  onOpenPreview,
  resolveEntry,
  sources,
}: DictionarySourceResultsProps) {
  return (
    <div className="dictionary-popover__sources">
      {sources.map((source) => (
        <section className="dictionary-popover__source-group" key={source.id}>
          <h3 className="dictionary-popover__source-heading">
            <span>
              {source.heading ?? '释义'}
              (来源：
            </span>
            {source.href ? (
              <a href={source.href} rel="noreferrer" target="_blank">
                {source.label}
              </a>
            ) : (
              source.label
            )}
            <span>)：</span>
          </h3>
          {source.meanings.length > 0 ? (
            <ol className="dictionary-popover__meanings">
              {source.meanings.map((meaning) => (
                <li className="dictionary-popover__meaning" key={meaning.id}>
                  {meaning.partOfSpeech ? (
                    <span className="dictionary-popover__part-of-speech">
                      {meaning.partOfSpeech}
                    </span>
                  ) : null}
                  <div className="dictionary-popover__definition">
                    <InteractiveContent onOpenPreview={onOpenPreview} resolveEntry={resolveEntry}>
                      {meaning.definition}
                    </InteractiveContent>
                  </div>
                  {meaning.example ? (
                    <blockquote className="dictionary-popover__example">
                      <InteractiveContent onOpenPreview={onOpenPreview} resolveEntry={resolveEntry}>
                        {meaning.example}
                      </InteractiveContent>
                    </blockquote>
                  ) : null}
                  {meaning.examples?.map((example) => (
                    <blockquote className="dictionary-popover__example" key={example}>
                      <InteractiveContent onOpenPreview={onOpenPreview} resolveEntry={resolveEntry}>
                        {example}
                      </InteractiveContent>
                    </blockquote>
                  ))}
                </li>
              ))}
            </ol>
          ) : null}
          {source.examples?.map((example) => (
            <blockquote className="dictionary-popover__source-example" key={example}>
              <InteractiveContent onOpenPreview={onOpenPreview} resolveEntry={resolveEntry}>
                {example}
              </InteractiveContent>
            </blockquote>
          ))}
        </section>
      ))}
    </div>
  );
}

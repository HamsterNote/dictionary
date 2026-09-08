import { Button } from '@hamster-note/components/button';
import { Icon } from '@hamster-note/components/icon';
import { TextField } from '@hamster-note/components/text-field';
import { useId, useRef, useState } from 'react';
import type { ResolvedDictionaryCorrectionsControl } from './dictionaryCorrections';
import { applyDictionaryCorrectionToSummary } from './dictionaryCorrectionApply';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { formatDictionaryPhonetic } from './formatDictionaryPhonetic';

interface DictionarySearchProps {
  readonly corrections?: ResolvedDictionaryCorrectionsControl;
  readonly label: string;
  readonly onQueryChange: ((query: string) => void) | undefined;
  readonly onSearch: ((query: string) => void) | undefined;
  readonly placeholder: string;
  readonly query: string;
  readonly suggestions: readonly DictionaryEntrySummary[];
}

export function DictionarySearch({
  corrections,
  label,
  onQueryChange,
  onSearch,
  placeholder,
  query,
  suggestions,
}: DictionarySearchProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isExpanded, setIsExpanded] = useState(false);
  const canExpand = query.trim().length > 0 && suggestions.length > 0;
  const displaySuggestions =
    corrections === undefined
      ? suggestions.map((suggestion) => ({
          entry: suggestion,
          originalWord: suggestion.word,
        }))
      : suggestions.map((suggestion) => {
          const corrected = applyDictionaryCorrectionToSummary(suggestion, corrections);
          return { entry: corrected.summary, originalWord: corrected.originalWord };
        });

  const focusQueryInput = (): void => {
    const input = formRef.current?.elements.namedItem('dictionary-query');
    if (input instanceof HTMLInputElement) input.focus();
  };

  const selectSuggestion = (suggestion: { originalWord: string }): void => {
    // 提交始终使用原始词头：查找、导航与历史不感知纠错后的拼写。
    onSearch?.(suggestion.originalWord);
    setActiveIndex(-1);
    setIsExpanded(false);
    focusQueryInput();
  };

  const activeSuggestion =
    isExpanded && canExpand && activeIndex >= 0 ? displaySuggestions[activeIndex] : undefined;

  return (
    <search className="dictionary-popover__search-region">
      <form
        className="dictionary-popover__search"
        onSubmit={(event) => {
          event.preventDefault();
          if (activeSuggestion !== undefined) {
            selectSuggestion(activeSuggestion);
            return;
          }
          onSearch?.(query);
          setActiveIndex(-1);
          setIsExpanded(false);
        }}
        ref={formRef}
      >
        <Icon aria-hidden="true" className="dictionary-popover__search-icon" name="search" />
        <TextField
          aria-activedescendant={
            activeSuggestion === undefined ? undefined : `${listboxId}-${String(activeIndex)}`
          }
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isExpanded && canExpand}
          autoComplete="off"
          id={inputId}
          label={label}
          name="dictionary-query"
          onBlur={() => {
            setActiveIndex(-1);
            setIsExpanded(false);
          }}
          onChange={(event) => {
            onQueryChange?.(event.currentTarget.value);
            setActiveIndex(-1);
            setIsExpanded(true);
          }}
          onFocus={() => {
            setIsExpanded(canExpand);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setIsExpanded(false);
              setActiveIndex(-1);
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setIsExpanded(canExpand);
            if (!canExpand) return;
            setActiveIndex((currentIndex) => {
              if (event.key === 'ArrowDown') {
                return currentIndex >= displaySuggestions.length - 1 ? 0 : currentIndex + 1;
              }
              return currentIndex <= 0 ? displaySuggestions.length - 1 : currentIndex - 1;
            });
          }}
          placeholder={placeholder}
          readOnly={onQueryChange === undefined}
          role="combobox"
          spellCheck={false}
          type="search"
          value={query}
        />
        {query.length === 0 || onQueryChange === undefined ? null : (
          <Button
            aria-label="清除搜索内容"
            className="dictionary-popover__clear"
            ghost
            onClick={() => {
              onQueryChange('');
              setActiveIndex(-1);
              setIsExpanded(false);
              focusQueryInput();
            }}
            size="small"
          >
            <Icon aria-hidden="true" name="close" />
          </Button>
        )}
      </form>
      {isExpanded && canExpand ? (
        <div
          aria-label="搜索建议"
          className="dictionary-popover__suggestions"
          id={listboxId}
          role="listbox"
          tabIndex={-1}
        >
          {displaySuggestions.map((suggestion, index) => (
            <Button
              aria-selected={index === activeIndex}
              className="dictionary-popover__suggestion"
              id={`${listboxId}-${String(index)}`}
              key={suggestion.originalWord}
              ghost
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                selectSuggestion(suggestion);
              }}
              role="option"
              size="small"
              tabIndex={-1}
            >
              <span className="dictionary-popover__suggestion-word">{suggestion.entry.word}</span>
              {suggestion.entry.phonetic ? (
                <span className="dictionary-popover__suggestion-phonetic">
                  {formatDictionaryPhonetic(suggestion.originalWord, suggestion.entry.phonetic)}
                </span>
              ) : null}
              <span className="dictionary-popover__suggestion-definition">
                {suggestion.entry.definition}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </search>
  );
}

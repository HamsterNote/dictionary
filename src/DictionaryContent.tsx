import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useCallback, useId, useRef, useState } from 'react';
import { DictionaryContentCorrection } from './DictionaryContentCorrection';
import { DictionaryCorrectionDetailsButton } from './DictionaryCorrectionDetailsButton';
import { DictionarySourceResults } from './DictionarySourceResults';
import {
  type DictionaryGetDetail,
  type DictionaryMeaning,
  type DictionarySearch,
  type DictionarySource,
  getDetail as defaultGetDetail,
  search as defaultSearch,
} from './dictionaryData';
import type {
  DictionaryCorrectionsControl,
  ResolvedDictionaryCorrectionsControl,
} from './dictionaryCorrections';
import { resolveDictionaryCorrection } from './dictionaryCorrections';
import type { DictionaryEntrySummary } from './dictionaryEntrySummary';
import { PronunciationButton } from './PronunciationButton';
import { formatDictionaryPhonetic } from './formatDictionaryPhonetic';
import { useDictionaryCorrectedContent } from './useDictionaryCorrectedContent';
import { useDictionaryCorrections } from './useDictionaryCorrections';

interface DictionaryContentStyle extends CSSProperties {
  readonly '--dictionary-accent'?: string;
  readonly '--dictionary-accent-soft'?: string;
  readonly '--dictionary-accent-strong'?: string;
  readonly '--dictionary-accent-text'?: string;
  readonly '--dictionary-focus'?: string;
  readonly '--dictionary-text-primary'?: string;
  readonly '--dictionary-text-secondary'?: string;
}

export interface DictionaryContentProps extends Omit<HTMLAttributes<HTMLElement>, 'color'> {
  readonly corrections?: DictionaryCorrectionsControl;
  readonly emptyMessage?: ReactNode;
  readonly getDetail?: DictionaryGetDetail;
  readonly headingId?: string;
  readonly keyword: string;
  readonly meanings?: readonly DictionaryMeaning[];
  readonly onOpenPreview?: (entry: DictionaryEntrySummary, anchor: HTMLButtonElement) => void;
  readonly phonetic?: string;
  readonly pronounce?: (word: string) => Promise<void>;
  readonly resolveEntry?: (word: string) => DictionaryEntrySummary | undefined;
  readonly resolvedCorrections?: ResolvedDictionaryCorrectionsControl;
  readonly search?: DictionarySearch;
  readonly showGuide?: boolean;
  readonly sources?: readonly DictionarySource[];
  readonly textColor?: string;
  readonly themeColor?: string;
}

export function DictionaryContent({
  className,
  corrections,
  emptyMessage = (
    <>
      没有找到精确释义。<span className="dictionary-popover__nowrap">请检查拼写</span>
      ，或换一个词再试。
    </>
  ),
  getDetail = defaultGetDetail,
  headingId: providedHeadingId,
  id,
  keyword,
  meanings: providedMeanings,
  onOpenPreview,
  phonetic: providedPhonetic,
  pronounce,
  resolveEntry,
  resolvedCorrections,
  search = defaultSearch,
  showGuide = false,
  sources: providedSources,
  style,
  textColor,
  themeColor,
  ...props
}: DictionaryContentProps) {
  const generatedId = useId();
  const correctionTriggerRef = useRef<HTMLButtonElement>(null);
  const headingId = providedHeadingId ?? generatedId;
  const [selection, setSelection] = useState({ activeKeyword: keyword, propKeyword: keyword });
  if (selection.propKeyword !== keyword) {
    setSelection({ activeKeyword: keyword, propKeyword: keyword });
  }
  const activeKeyword = selection.propKeyword === keyword ? selection.activeKeyword : keyword;
  const correctionStore = useDictionaryCorrections(corrections);
  const effectiveCorrections = resolvedCorrections ?? {
    disabled: correctionStore.disabled,
    editable: correctionStore.editable,
    managed: correctionStore.managed,
    onChange: correctionStore.onChange,
    system: correctionStore.system,
    user: correctionStore.user,
  };
  const resolvedContent = useDictionaryCorrectedContent({
    activeKeyword,
    corrections: effectiveCorrections,
    getDetail,
    providedMeanings,
    providedPhonetic,
    providedSources,
  });
  const searchEntry = useCallback(
    (word: string) => {
      const normalizedWord = word.trim().normalize('NFKC').toLocaleLowerCase('en-US');
      const candidates = search(word);
      return candidates.find(
        (candidate) =>
          candidate.word.trim().normalize('NFKC').toLocaleLowerCase('en-US') === normalizedWord,
      );
    },
    [search],
  );
  const interactiveResolver = resolveEntry ?? searchEntry;
  const openPreview =
    onOpenPreview ??
    ((entry: DictionaryEntrySummary) => {
      if (getDetail(entry.word) !== undefined) {
        setSelection({ activeKeyword: entry.word, propKeyword: keyword });
      }
    });
  const userCorrection = resolveDictionaryCorrection(activeKeyword, {
    user: correctionStore.user,
  });
  const deleteUserCorrection =
    correctionStore.editable && userCorrection !== undefined
      ? () => {
          correctionStore.reset(activeKeyword);
          requestAnimationFrame(() => {
            correctionTriggerRef.current?.focus();
          });
        }
      : undefined;
  const contentClassName = className ? `dictionary-content ${className}` : 'dictionary-content';
  const contentStyle: DictionaryContentStyle = {
    ...style,
    ...(textColor === undefined
      ? {}
      : {
          '--dictionary-text-primary': textColor,
          '--dictionary-text-secondary': `color-mix(in srgb, ${textColor} 68%, transparent)`,
        }),
    ...(themeColor === undefined
      ? {}
      : {
          '--dictionary-accent': themeColor,
          '--dictionary-accent-soft': `color-mix(in srgb, ${themeColor} 12%, transparent)`,
          '--dictionary-accent-strong': themeColor,
          '--dictionary-accent-text': themeColor,
          '--dictionary-focus': themeColor,
        }),
  };

  return (
    <section
      {...props}
      aria-labelledby={headingId}
      className={contentClassName}
      id={id}
      style={contentStyle}
    >
      <header className="dictionary-popover__header">
        <div>
          <div className="dictionary-popover__headword-row">
            <h2 className="dictionary-popover__word" id={headingId}>
              {resolvedContent.word}
            </h2>
            <DictionaryContentCorrection
              activeKeyword={activeKeyword}
              corrections={effectiveCorrections}
              originalPhonetic={resolvedContent.originalPhonetic}
              phonetic={resolvedContent.phonetic ?? ''}
              store={correctionStore}
              themeStyle={contentStyle}
              triggerRef={correctionTriggerRef}
            />
          </div>
          {resolvedContent.phonetic ? (
            <div className="dictionary-popover__pronunciation-row">
              <p className="dictionary-popover__phonetic">
                {formatDictionaryPhonetic(activeKeyword, resolvedContent.phonetic)}
              </p>
              <DictionaryCorrectionDetailsButton
                changes={resolvedContent.changes.filter((change) => change.field === 'phonetic')}
                key={activeKeyword}
                onDelete={deleteUserCorrection}
                themeStyle={contentStyle}
                word={resolvedContent.word}
              />
              {pronounce ? (
                <PronunciationButton pronounce={pronounce} word={activeKeyword} />
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="dictionary-popover__results">
        <span
          aria-atomic="true"
          aria-live="polite"
          className="dictionary-popover__status"
          role="status"
        >
          {showGuide
            ? '仓鼠词典已就绪'
            : resolvedContent.meanings.length === 0
              ? '没有找到释义'
              : `找到 ${String(resolvedContent.meanings.length)} 条释义`}
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
        ) : resolvedContent.meanings.length === 0 ? (
          <p className="dictionary-popover__empty">{emptyMessage}</p>
        ) : (
          <DictionarySourceResults
            changes={resolvedContent.changes.filter((change) => change.field !== 'phonetic')}
            onDeleteCorrection={deleteUserCorrection}
            onOpenPreview={openPreview}
            resolveEntry={interactiveResolver}
            sources={
              resolvedContent.sources ?? [
                { id: 'dictionary', label: '词典', meanings: resolvedContent.meanings },
              ]
            }
            themeStyle={contentStyle}
            word={resolvedContent.word}
          />
        )}
      </div>
    </section>
  );
}

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import { DictionaryContentCorrection } from './DictionaryContentCorrection';
import { resolveDictionaryContentSelection } from './dictionaryContentSelection';
import { DictionaryCorrectionDetailsButton } from './DictionaryCorrectionDetailsButton';
import { DictionarySourceResults } from './DictionarySourceResults';
import {
  type DictionaryGetDetail,
  type DictionaryMeaning,
  type DictionarySearch,
  type DictionarySource,
  getDetail as defaultGetDetail,
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

// public props（themeColor/textColor）只写入 --dictionary-*-custom 输入令牌，
// 绝不 inline 覆盖 --dictionary-accent 等语义令牌：inline 优先级会压过
// dark media 的 :root 覆盖，导致深色下对比度不达标。语义令牌由
// .dictionary-content / .dictionary-correction 在 CSS 中引用输入令牌（亮色），
// dark media 再对组件级语义令牌显式切换到安全深色（忽略输入令牌）。
interface DictionaryContentStyle extends CSSProperties {
  readonly '--dictionary-accent-custom'?: string;
  readonly '--dictionary-accent-soft-custom'?: string;
  readonly '--dictionary-accent-strong-custom'?: string;
  readonly '--dictionary-accent-text-custom'?: string;
  readonly '--dictionary-focus-custom'?: string;
  readonly '--dictionary-text-primary-custom'?: string;
  readonly '--dictionary-text-secondary-custom'?: string;
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
  /** @deprecated 正文交互请同时提供 O(1) 的 resolveEntry 与 onOpenPreview。 */
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
  // search 仅保留 API 兼容：正文交互必须通过 resolveEntry（配合 onOpenPreview）显式接线。
  // 这里必须消费掉它，避免它随 ...props 透传到 <section> 上。
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- 内部兼容层必须消费已弃用属性。
  search: legacySearch,
  showGuide = false,
  sources: providedSources,
  style,
  textColor,
  themeColor,
  ...props
}: DictionaryContentProps) {
  // 兼容旧调用签名：search 不再参与任何解析或交互，正文交互统一使用 resolveEntry。
  void legacySearch;
  const generatedId = useId();
  const correctionTriggerRef = useRef<HTMLButtonElement>(null);
  const headingId = providedHeadingId ?? generatedId;
  const [selection, setSelection] = useState({ activeKeyword: keyword, propKeyword: keyword });
  if (selection.propKeyword !== keyword) {
    setSelection({ activeKeyword: keyword, propKeyword: keyword });
  }
  const { activeKeyword, useProvidedContent } = resolveDictionaryContentSelection(
    selection,
    keyword,
  );
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
    providedMeanings: useProvidedContent ? providedMeanings : undefined,
    providedPhonetic: useProvidedContent ? providedPhonetic : undefined,
    providedSources: useProvidedContent ? providedSources : undefined,
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
  // 亮色定制输入令牌：仅 dark media 之外的 CSS 映射会引用它们。
  // 该对象同时作为 portal（.dictionary-correction）的 themeStyle，
  // 因此 portal 也不会收到任何危险的 inline 语义令牌。
  const contentStyle: DictionaryContentStyle = {
    ...style,
    ...(textColor === undefined
      ? {}
      : {
          '--dictionary-text-primary-custom': textColor,
          '--dictionary-text-secondary-custom': `color-mix(in srgb, ${textColor} 68%, transparent)`,
        }),
    ...(themeColor === undefined
      ? {}
      : {
          '--dictionary-accent-custom': themeColor,
          '--dictionary-accent-soft-custom': `color-mix(in srgb, ${themeColor} 12%, transparent)`,
          '--dictionary-accent-strong-custom': themeColor,
          '--dictionary-accent-text-custom': themeColor,
          '--dictionary-focus-custom': themeColor,
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
            onOpenPreview={resolveEntry && onOpenPreview ? onOpenPreview : undefined}
            resolveEntry={resolveEntry && onOpenPreview ? resolveEntry : undefined}
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

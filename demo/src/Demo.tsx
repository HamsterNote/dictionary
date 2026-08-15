import { type ThemeAccentPreset, ThemeProvider } from '@hamster-note/components/theme';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DictionaryContent,
  type DictionaryEntrySummary,
  ENGLISH_CHINESE_CORE_GZIP_BYTES,
  getDetail as getDictionaryDetail,
  HamsterDictionary,
  HamsterDictionaryPopover,
  resolveChineseEntry,
  resolveEnglishChineseEntry,
  search as searchDictionary,
} from '../../src';
import type { KokoroPronouncer } from '../../src/kokoro';
import { useDictionaryNavigation } from '../../src/useDictionaryNavigation';
import { CopyrightNoticeDownload } from './CopyrightNoticeDownload';
import { DICTIONARY_PACK_GROUPS } from './dictionaryPacks';
import { createDictionaryView } from './dictionaryView';
import { FeatureOptions } from './FeatureOptions';
import { createSupplementImpacts } from './supplementImpacts';
import { ThemeColorSettings } from './ThemeColorSettings';
import { useDictionaryPacks } from './useDictionaryPacks';
import { VocabularyPackPicker } from './VocabularyPackPicker';

const BASE_LIBRARY_OVERHEAD_GZIP_BYTES = 12_000;
const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

export function Demo() {
  const [isOpen, setIsOpen] = useState(true);
  const [isPronunciationEnabled, setIsPronunciationEnabled] = useState(false);
  const [query, setQuery] = useState('');
  const [themeAccent, setThemeAccent] = useState<ThemeAccentPreset>('blue');
  const focusTargetRef = useRef<'popover' | 'trigger' | null>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const pronouncerPromiseRef = useRef<Promise<KokoroPronouncer> | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dictionaryPacks = useDictionaryPacks();
  const supplementImpacts = useMemo(
    () => createSupplementImpacts(dictionaryPacks.activeIds),
    [dictionaryPacks.activeIds],
  );
  const estimatedGzipBytes = [
    ...dictionaryPacks.chineseDictionaryPacks,
    ...dictionaryPacks.englishVocabularyPacks,
    ...dictionaryPacks.englishExampleSentencePacks,
    ...dictionaryPacks.englishInflectionFormsPacks,
    ...dictionaryPacks.englishInflectionIndexPacks,
    ...dictionaryPacks.englishRootPacks,
    ...dictionaryPacks.englishSynonymPacks,
  ].reduce(
    (total, dictionaryPack) => total + dictionaryPack.gzipBytes,
    ENGLISH_CHINESE_CORE_GZIP_BYTES + BASE_LIBRARY_OVERHEAD_GZIP_BYTES,
  );
  const navigation = useDictionaryNavigation({
    onQueryChange: setQuery,
    onSearch: undefined,
    query,
  });
  const isChineseQuery = HAN_CHARACTER_PATTERN.test(navigation.committedQuery);
  const isChineseSearch = HAN_CHARACTER_PATTERN.test(query);
  const dictionaryView = useMemo(
    () =>
      createDictionaryView({
        chineseDictionaryPacks: dictionaryPacks.chineseDictionaryPacks,
        committedQuery: navigation.committedQuery,
        englishExampleSentencePacks: dictionaryPacks.englishExampleSentencePacks,
        englishInflectionFormsPacks: dictionaryPacks.englishInflectionFormsPacks,
        englishInflectionIndexPacks: dictionaryPacks.englishInflectionIndexPacks,
        englishRootPacks: dictionaryPacks.englishRootPacks,
        englishSynonymPacks: dictionaryPacks.englishSynonymPacks,
        englishVocabularyPacks: dictionaryPacks.englishVocabularyPacks,
        isChineseQuery,
        isChineseSearch,
        query,
      }),
    [
      dictionaryPacks.chineseDictionaryPacks,
      dictionaryPacks.englishExampleSentencePacks,
      dictionaryPacks.englishInflectionFormsPacks,
      dictionaryPacks.englishInflectionIndexPacks,
      dictionaryPacks.englishRootPacks,
      dictionaryPacks.englishSynonymPacks,
      dictionaryPacks.englishVocabularyPacks,
      isChineseQuery,
      isChineseSearch,
      navigation.committedQuery,
      query,
    ],
  );
  const resolveEntry = useCallback(
    (word: string) =>
      HAN_CHARACTER_PATTERN.test(word)
        ? resolveChineseEntry(word, dictionaryPacks.chineseDictionaryPacks)
        : resolveEnglishChineseEntry(word, dictionaryPacks.englishVocabularyPacks, {
            index: dictionaryPacks.englishInflectionIndexPacks,
          }),
    [
      dictionaryPacks.chineseDictionaryPacks,
      dictionaryPacks.englishInflectionIndexPacks,
      dictionaryPacks.englishVocabularyPacks,
    ],
  );
  const search = useCallback(
    (word: string) =>
      searchDictionary(word, {
        chineseDictionaryPacks: dictionaryPacks.chineseDictionaryPacks,
        englishInflectionIndexPacks: dictionaryPacks.englishInflectionIndexPacks,
        englishVocabularyPacks: dictionaryPacks.englishVocabularyPacks,
      }),
    [
      dictionaryPacks.chineseDictionaryPacks,
      dictionaryPacks.englishInflectionIndexPacks,
      dictionaryPacks.englishVocabularyPacks,
    ],
  );
  const getDetail = useCallback(
    (word: string) =>
      getDictionaryDetail(word, {
        chineseDictionaryPacks: dictionaryPacks.chineseDictionaryPacks,
        englishExampleSentencePacks: dictionaryPacks.englishExampleSentencePacks,
        englishInflectionFormsPacks: dictionaryPacks.englishInflectionFormsPacks,
        englishInflectionIndexPacks: dictionaryPacks.englishInflectionIndexPacks,
        englishRootPacks: dictionaryPacks.englishRootPacks,
        englishSynonymPacks: dictionaryPacks.englishSynonymPacks,
        englishVocabularyPacks: dictionaryPacks.englishVocabularyPacks,
      }),
    [
      dictionaryPacks.chineseDictionaryPacks,
      dictionaryPacks.englishExampleSentencePacks,
      dictionaryPacks.englishInflectionFormsPacks,
      dictionaryPacks.englishInflectionIndexPacks,
      dictionaryPacks.englishRootPacks,
      dictionaryPacks.englishSynonymPacks,
      dictionaryPacks.englishVocabularyPacks,
    ],
  );

  const inlineDemoEntry = useMemo<DictionaryEntrySummary>(() => {
    const resolved = resolveEntry('durable');
    return (
      resolved ?? {
        definition: '耐用的；持久的；坚固的。',
        phonetic: '/ˈdʊrəbl/',
        word: 'durable',
      }
    );
  }, [resolveEntry]);

  const openInlineWord = useCallback(
    (word: string) => {
      focusTargetRef.current = 'popover';
      setIsOpen(true);
      navigation.search(word);
    },
    [navigation],
  );

  useEffect(() => {
    if (isOpen && focusTargetRef.current === 'popover') popoverRef.current?.focus();
    if (!isOpen && focusTargetRef.current === 'trigger') triggerRef.current?.focus();
    focusTargetRef.current = null;
  }, [isOpen]);

  useEffect(
    () => () => {
      void pronouncerPromiseRef.current?.then((pronouncer) => {
        pronouncer.dispose();
      });
    },
    [],
  );

  const pronounceWord = useCallback(async (word: string) => {
    pronouncerPromiseRef.current ??= import('../../src/kokoro').then(({ createKokoroPronouncer }) =>
      createKokoroPronouncer(),
    );
    const pronouncer = await pronouncerPromiseRef.current;
    await pronouncer.pronounce(word);
  }, []);

  const togglePronunciation = (enabled: boolean) => {
    setIsPronunciationEnabled(enabled);
    if (enabled) return;
    void pronouncerPromiseRef.current?.then((pronouncer) => {
      pronouncer.dispose();
    });
    pronouncerPromiseRef.current = undefined;
  };

  return (
    <ThemeProvider accent={themeAccent} className="demo-theme" mode="light">
      <main className="demo-shell">
        <section className="demo-copy" aria-labelledby="demo-title">
          <p className="demo-eyebrow">@hamster-note/dictionary</p>
          <h1 id="demo-title">
            <span>不离开当前思路，</span>
            <span>读懂眼前的词。</span>
          </h1>
          <p className="demo-intro">
            <span className="cjk-keep">一个面向 React 19 的</span>
            <wbr />
            <span className="cjk-keep">轻量词典悬浮窗</span>。
            <wbr />
            <span className="cjk-keep">它把释义、词性和例句放进</span>
            <wbr />
            <span className="cjk-keep">安静的阅读表面</span>，
            <span className="cjk-keep">适合笔记</span>、编辑器和知识库产品。
          </p>
          <div className="demo-meta">
            <span>{dictionaryView.totalEntries.toLocaleString('zh-CN')} 个唯一词头</span>
            <span>按需扩充</span>
            <span>Vite 8</span>
          </div>
          <section className="demo-content-example" aria-labelledby="content-example-title">
            <p className="demo-eyebrow" id="content-example-title">
              独立文字内容
            </p>
            <DictionaryContent
              getDetail={getDetail}
              keyword="note"
              search={search}
              textColor="#37342f"
              themeColor="#146ebe"
            />
          </section>
          <VocabularyPackPicker
            activeIds={dictionaryPacks.activeIds}
            {...(dictionaryPacks.loadError ? { errorMessage: dictionaryPacks.loadError } : {})}
            estimatedGzipBytes={estimatedGzipBytes}
            loadingIds={dictionaryPacks.loadingIds}
            onToggle={dictionaryPacks.toggle}
            groups={DICTIONARY_PACK_GROUPS}
            supplementImpacts={supplementImpacts}
          />
          <FeatureOptions
            onPronunciationToggle={togglePronunciation}
            pronunciationEnabled={isPronunciationEnabled}
          />
          <ThemeColorSettings accent={themeAccent} onAccentChange={setThemeAccent} />
          <CopyrightNoticeDownload
            activeIds={dictionaryPacks.activeIds}
            isSelectionPending={dictionaryPacks.loadingIds.size > 0}
          />
        </section>

        <section className="demo-stage" aria-label="词典悬浮窗演示">
          <div className="demo-document" aria-hidden="true">
            <span className="demo-document__label">Research note · 12 Aug</span>
            <p>
              Capture each useful <mark>note</mark> before the context disappears. Small
              observations become{' '}
              <HamsterDictionaryPopover entry={inlineDemoEntry} onExpand={openInlineWord}>
                durable
              </HamsterDictionaryPopover>{' '}
              knowledge when they stay close to the work.
            </p>
          </div>

          <div className="demo-popover-slot">
            <HamsterDictionary
              emptyMessage={dictionaryView.emptyMessage}
              getDetail={getDetail}
              {...(navigation.canGoBack ? { onBack: navigation.goBack } : {})}
              {...(navigation.canGoForward ? { onForward: navigation.goForward } : {})}
              onClose={() => {
                focusTargetRef.current = 'trigger';
                setIsOpen(false);
              }}
              onQueryChange={navigation.onQueryChange}
              onSearch={navigation.search}
              open={isOpen}
              {...(!isChineseQuery && isPronunciationEnabled ? { pronounce: pronounceWord } : {})}
              query={query}
              ref={popoverRef}
              search={search}
              searchLabel={dictionaryView.searchLabel}
              searchPlaceholder={dictionaryView.searchPlaceholder}
              showGuide={navigation.committedQuery.length === 0}
              tabIndex={-1}
              word={dictionaryView.word}
            />
            {isOpen ? null : (
              <button
                className="demo-trigger"
                onClick={() => {
                  focusTargetRef.current = 'popover';
                  setIsOpen(true);
                }}
                ref={triggerRef}
                type="button"
              >
                重新打开词典
              </button>
            )}
          </div>
        </section>
      </main>
    </ThemeProvider>
  );
}

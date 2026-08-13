import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ENGLISH_CHINESE_CORE_GZIP_BYTES,
  EnglishChineseDictionaryPopover,
  type EnglishChineseVocabularyPack,
} from '../../src';
import {
  BNC_VOCABULARY_METADATA,
  CET4_VOCABULARY_METADATA,
  CET6_VOCABULARY_METADATA,
  GK_VOCABULARY_METADATA,
  GRE_VOCABULARY_METADATA,
  IELTS_VOCABULARY_METADATA,
  KY_VOCABULARY_METADATA,
  TOEFL_VOCABULARY_METADATA,
  ZK_VOCABULARY_METADATA,
} from '../../src/data/ecdictManifest';
import type { VocabularyPackGroup } from './VocabularyPackPicker';
import { VocabularyPackPicker } from './VocabularyPackPicker';

type VocabularyPackId = 'bnc' | 'cet4' | 'cet6' | 'gk' | 'gre' | 'ielts' | 'ky' | 'toefl' | 'zk';

const BASE_LIBRARY_OVERHEAD_GZIP_BYTES = 12_000;
const PACK_MODULE_OVERHEAD_GZIP_BYTES = 5_000;
const VOCABULARY_PACK_ORDER: readonly VocabularyPackId[] = [
  'zk',
  'gk',
  'cet4',
  'cet6',
  'ky',
  'ielts',
  'toefl',
  'gre',
  'bnc',
];
const VOCABULARY_PACK_GROUPS: readonly VocabularyPackGroup[] = [
  {
    id: 'school',
    label: '基础学段',
    options: [ZK_VOCABULARY_METADATA, GK_VOCABULARY_METADATA],
  },
  {
    id: 'domestic',
    label: '国内英语考试',
    options: [CET4_VOCABULARY_METADATA, CET6_VOCABULARY_METADATA, KY_VOCABULARY_METADATA],
  },
  {
    id: 'international',
    label: '留学考试',
    options: [IELTS_VOCABULARY_METADATA, TOEFL_VOCABULARY_METADATA, GRE_VOCABULARY_METADATA],
  },
  {
    id: 'corpus',
    label: '语料词频',
    options: [BNC_VOCABULARY_METADATA],
  },
];
const VOCABULARY_PACK_LOADERS: Readonly<
  Record<VocabularyPackId, () => Promise<EnglishChineseVocabularyPack>>
> = {
  bnc: () => import('../../src/vocabulary-packs/bnc').then((module) => module.bncVocabularyPack),
  cet4: () => import('../../src/vocabulary-packs/cet4').then((module) => module.cet4VocabularyPack),
  cet6: () => import('../../src/vocabulary-packs/cet6').then((module) => module.cet6VocabularyPack),
  gk: () => import('../../src/vocabulary-packs/gk').then((module) => module.gkVocabularyPack),
  gre: () => import('../../src/vocabulary-packs/gre').then((module) => module.greVocabularyPack),
  ielts: () =>
    import('../../src/vocabulary-packs/ielts').then((module) => module.ieltsVocabularyPack),
  ky: () => import('../../src/vocabulary-packs/ky').then((module) => module.kyVocabularyPack),
  toefl: () =>
    import('../../src/vocabulary-packs/toefl').then((module) => module.toeflVocabularyPack),
  zk: () => import('../../src/vocabulary-packs/zk').then((module) => module.zkVocabularyPack),
};

function isVocabularyPackId(id: string): id is VocabularyPackId {
  return (
    id === 'bnc' ||
    id === 'cet4' ||
    id === 'cet6' ||
    id === 'gk' ||
    id === 'gre' ||
    id === 'ielts' ||
    id === 'ky' ||
    id === 'toefl' ||
    id === 'zk'
  );
}

export function Demo() {
  const [activePacks, setActivePacks] = useState<ReadonlyMap<string, EnglishChineseVocabularyPack>>(
    new Map(),
  );
  const [isOpen, setIsOpen] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('note');
  const focusTargetRef = useRef<'popover' | 'trigger' | null>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const vocabularyPacks = useMemo(
    () =>
      VOCABULARY_PACK_ORDER.flatMap((id) => {
        const vocabularyPack = activePacks.get(id);
        return vocabularyPack === undefined ? [] : [vocabularyPack];
      }),
    [activePacks],
  );
  const estimatedGzipBytes = vocabularyPacks.reduce(
    (total, vocabularyPack) => total + vocabularyPack.gzipBytes + PACK_MODULE_OVERHEAD_GZIP_BYTES,
    ENGLISH_CHINESE_CORE_GZIP_BYTES + BASE_LIBRARY_OVERHEAD_GZIP_BYTES,
  );

  useEffect(() => {
    if (isOpen && focusTargetRef.current === 'popover') popoverRef.current?.focus();
    if (!isOpen && focusTargetRef.current === 'trigger') triggerRef.current?.focus();
    focusTargetRef.current = null;
  }, [isOpen]);

  const toggleVocabularyPack = (id: string, enabled: boolean) => {
    if (!isVocabularyPackId(id)) return;
    setLoadError('');
    if (!enabled) {
      setActivePacks((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      return;
    }

    setLoadingIds((current) => new Set(current).add(id));
    void VOCABULARY_PACK_LOADERS[id]().then(
      (vocabularyPack) => {
        setActivePacks((current) => new Map(current).set(id, vocabularyPack));
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      },
      () => {
        const failedPack = VOCABULARY_PACK_GROUPS.flatMap((group) => group.options).find(
          (option) => option.id === id,
        );
        setLoadError(`${failedPack?.label ?? id} 词汇包加载失败，请检查网络后重试。`);
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      },
    );
  };

  return (
    <main className="demo-shell">
      <section className="demo-copy" aria-labelledby="demo-title">
        <p className="demo-eyebrow">@hamster-note/dictionary</p>
        <h1 id="demo-title">
          <span>不离开当前思路，</span>
          <span>读懂眼前的词。</span>
        </h1>
        <p className="demo-intro">
          一个面向 <span className="cjk-keep">React 19 的轻量词典悬浮窗</span>。
          <wbr />
          <span className="cjk-keep">它把释义、词性和例句</span>放进
          <wbr />
          <span className="cjk-keep">安静的阅读表面</span>
          ，适合笔记、编辑器和知识库产品。
        </p>
        <div className="demo-meta">
          <span>5,000 词核心</span>
          <span>按需扩充</span>
          <span>Vite 8</span>
        </div>
        <VocabularyPackPicker
          activeIds={new Set(activePacks.keys())}
          {...(loadError ? { errorMessage: loadError } : {})}
          estimatedGzipBytes={estimatedGzipBytes}
          loadingIds={loadingIds}
          onToggle={toggleVocabularyPack}
          groups={VOCABULARY_PACK_GROUPS}
        />
      </section>

      <section className="demo-stage" aria-label="词典悬浮窗演示">
        <div className="demo-document" aria-hidden="true">
          <span className="demo-document__label">Research note · 12 Aug</span>
          <p>
            Capture each useful <mark>note</mark> before the context disappears. Small observations
            become durable knowledge when they stay close to the work.
          </p>
        </div>

        <div className="demo-popover-slot">
          <EnglishChineseDictionaryPopover
            onClose={() => {
              focusTargetRef.current = 'trigger';
              setIsOpen(false);
            }}
            onQueryChange={setQuery}
            open={isOpen}
            query={query}
            ref={popoverRef}
            tabIndex={-1}
            vocabularyPacks={vocabularyPacks}
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
  );
}

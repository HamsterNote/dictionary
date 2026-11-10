import { createRoot } from 'react-dom/client';
import { DictionarySearchContent } from '../../src/DictionarySearchContent';
import { HamsterDictionaryPopover } from '../../src/HamsterDictionaryPopover';
import type { DictionaryDataDetail } from '../../src/dictionaryData';
import '../../src/dictionary.css';

const summary = (word: string) => ({
  word,
  definition: new URLSearchParams(location.search).has('blank') ? '' : `摘要 ${word}`,
});
const detail = (word: string): DictionaryDataDetail => ({
  word,
  sources: [
    {
      id: 'a',
      label: '来源甲',
      meanings: [
        { id: 'a1', partOfSpeech: 'v.', definition: `A ${word} 完整义项；保留分号后的解释。` },
        { id: 'a2', partOfSpeech: 'n.', definition: `B ${word}` },
        { id: 'a3', partOfSpeech: 'v.', definition: `C ${word}` },
        { id: 'a4', definition: `D ${word}` },
        { id: 'empty', partOfSpeech: 'empty', definition: '  ' },
      ],
    },
    {
      id: 'b',
      label: '来源乙',
      meanings: [
        { id: 'b1', partOfSpeech: 'n.', definition: `E ${word}` },
        ...Array.from({ length: 24 }, (_, i) => ({
          id: `b${String(i + 2)}`,
          partOfSpeech: 'adj.',
          definition: `F${String(i)} ${word} 长义项完整文本。`,
        })),
      ],
    },
  ],
});
let held = false;
let failing = false;
let empty = new URLSearchParams(location.search).has('empty');
let enabled = true;
let mounted = true;
const pending: (() => void)[] = [];
const calls: string[] = [];
const expanded: string[] = [];
const provider = {
  search: () => Promise.resolve([]),
  resolveEntry: (word: string) => Promise.resolve(summary(word)),
  getDetail: async (word: string) => {
    calls.push(word);
    if (held) await new Promise<void>((resolve) => pending.push(resolve));
    if (failing) throw new Error('fixture detail error');
    return empty ? undefined : detail(word);
  },
};
const frameTrace: string[] = [];
const observed = new WeakSet<Element>();
new MutationObserver(() => {
  for (const element of document.querySelectorAll<HTMLElement>('.dictionary-word-preview')) {
    if (observed.has(element)) continue;
    observed.add(element);
    const sample = () => {
      if (!element.isConnected) return;
      if (getComputedStyle(element).visibility === 'visible')
        frameTrace.push(
          JSON.stringify({
            time: performance.now(),
            rect: {
              left: element.getBoundingClientRect().left,
              top: element.getBoundingClientRect().top,
              right: element.getBoundingClientRect().right,
              bottom: element.getBoundingClientRect().bottom,
            },
            layout: element.dataset['layout'],
          }),
        );
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
}).observe(document.body, { childList: true, subtree: true });
const container = document.getElementById('root');
if (!container) throw new Error('Missing fixture root');
const root = createRoot(container);
const render = () => {
  root.render(
    mounted && new URLSearchParams(location.search).has('standalone') ? (
      <HamsterDictionaryPopover
        entry={summary('probe')}
        getDetail={provider.getDetail}
        corrections={{ disabled: true }}
        onExpand={(word) => {
          expanded.push(word);
        }}
      >
        probe
      </HamsterDictionaryPopover>
    ) : mounted ? (
      <DictionarySearchContent
        word="主词条"
        meanings={[
          {
            id: 'main',
            definition:
              'probe next 甲乙丙丁戊己庚辛壬癸 pneumonoultramicroscopicsilicovolcanoconiosis',
          },
        ]}
        resolveEntry={summary}
        {...(new URLSearchParams(location.search).has('legacy') ? {} : { getDetail: detail })}
        {...(new URLSearchParams(location.search).has('legacy') ||
        new URLSearchParams(location.search).has('sync')
          ? {}
          : { provider })}
        definitionWordPreviewEnabled={enabled}
        corrections={
          new URLSearchParams(location.search).has('corrected')
            ? {
                user: { probe: { word: 'corrected', meaning: '纠错首义项', phonetic: 'fix' } },
                system: {},
              }
            : { disabled: true }
        }
        onSearch={(word) => {
          expanded.push(word);
        }}
      />
    ) : null,
  );
};
Object.assign(globalThis, {
  previewHarness: {
    calls,
    expanded,
    frameTrace,
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      pending
        .splice(0)
        .reverse()
        .forEach((resolve) => {
          resolve();
        });
    },
    fail: (value: boolean) => {
      failing = value;
    },
    empty: (value: boolean) => {
      empty = value;
    },
    enabled: (value: boolean) => {
      enabled = value;
      render();
    },
    mounted: (value: boolean) => {
      mounted = value;
      render();
    },
  },
});
render();

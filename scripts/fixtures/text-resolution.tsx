import { createRoot } from 'react-dom/client';
import { DictionarySearchContent } from '../../src/DictionarySearchContent';
import type { DictionaryProvider } from '../../src/dictionaryProvider';
import '../../src/dictionary.css';

const paragraphs = Array.from({ length: 48 }, (_, paragraph) => ({
  id: String(paragraph),
  definition: Array.from({ length: 24 }, (_, word) => {
    const index = paragraph * 24 + word;
    return `word${String.fromCharCode(97 + Math.floor(index / 676))}${String.fromCharCode(97 + (Math.floor(index / 26) % 26))}${String.fromCharCode(97 + (index % 26))}`;
  }).join(' '),
}));
let calls = 0;
let active = 0;
let concurrency = 0;
let hold = false;
let fail = false;
let release: (() => void) | undefined;
let syncReady = false;
const syncResolver = (word: string) =>
  syncReady ? { word, definition: 'Sync fixture' } : undefined;
const trace: string[] = [];
const provider: DictionaryProvider = {
  search: () => Promise.resolve([]),
  getDetail: () => Promise.resolve(undefined),
  resolveEntry: async (word, signal) => {
    signal?.throwIfAborted();
    calls += 1;
    trace.push(word);
    active += 1;
    concurrency = Math.max(concurrency, active);
    if (hold)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    // Controlled CPU cost; no network or dictionary cache variance.
    const start = performance.now();
    while (performance.now() - start < 0.35) {
      /* busy fixture */
    }
    await Promise.resolve();
    active -= 1;
    if (fail) {
      fail = false;
      throw new Error('Fixture failure');
    }
    return { word, definition: 'Fixture summary' };
  },
};

Object.assign(globalThis, { resolutionStats: () => ({ calls, concurrency, trace }) });
const container = document.getElementById('root');
const startButton = document.getElementById('start');
if (!container || !startButton) throw new Error('Missing fixture containers');
const root = createRoot(container);
Object.assign(globalThis, {
  resolutionHarness: {
    renderSync: (ready: boolean) => {
      syncReady = ready;
      root.render(
        <DictionarySearchContent word="sync" meanings={paragraphs} resolveEntry={syncResolver} />,
      );
    },
    hold: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      release?.();
    },
    fail: () => {
      fail = true;
    },
    render: (word: string) => {
      root.render(
        <DictionarySearchContent word={word} meanings={paragraphs} provider={provider} />,
      );
    },
    unmount: () => {
      root.render(null);
    },
  },
});
startButton.onclick = () => {
  root.render(<DictionarySearchContent word="fixture" meanings={paragraphs} provider={provider} />);
};

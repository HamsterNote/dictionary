import { createRoot } from 'react-dom/client';
import { HamsterDictionary } from '../../src/HamsterDictionary';
import '../../src/dictionary.css';

const parameters = new URLSearchParams(location.search);
const enabled = parameters.get('enabled') !== '0';
const maxHeight = Number(parameters.get('maxHeight')) || undefined;
let calls = 0;
let held = true;
let release: (() => void) | undefined;
const provider = {
  search: () => Promise.resolve([]),
  getDetail: () => Promise.resolve(undefined),
  resolveEntry: async (word: string, signal?: AbortSignal) => {
    calls++;
    if (held) await new Promise<void>((resolve) => (release = resolve));
    signal?.throwIfAborted();
    return { word, definition: `Summary of ${word}` };
  },
};
const root = document.getElementById('root');
if (!root) throw new Error('Missing main-scroll fixture root');
Object.assign(globalThis, {
  mainScrollHarness: {
    calls: () => calls,
    release: () => {
      held = false;
      release?.();
    },
  },
});
createRoot(root).render(
  <HamsterDictionary
    open
    word="long"
    phonetic="lɒŋ"
    definitionWordPreviewEnabled={enabled}
    corrections={{ disabled: true }}
    meanings={Array.from({ length: 60 }, (_, index) => ({
      id: String(index),
      definition: `probe meaning ${String(index + 1)}`,
    }))}
    provider={provider}
    {...(parameters.has('noquery') ? {} : { query: 'long', onQueryChange: () => undefined })}
    {...(maxHeight === undefined ? {} : { maxHeight })}
  />,
);

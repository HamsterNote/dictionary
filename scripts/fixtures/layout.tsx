import { createRoot } from 'react-dom/client';
import { DictionarySearchContent } from '../../src/DictionarySearchContent';
import { chineseDictionaryPack } from '../../src/dictionary-packs/chinese-dictionary';
import '../../src/dictionary.css';
import { createDictionaryProvider } from '../../src/dictionaryProvider';
import { chineseDictionaryWordsDictionaryPack } from '../../src/dictionary-packs/chinese-dictionary-words';
const actualProvider = createDictionaryProvider({
  chineseDictionaryPacks: [chineseDictionaryPack, chineseDictionaryWordsDictionaryPack],
});
const entry = chineseDictionaryPack.entries.get('行');
if (!entry) throw new Error('Missing 行 fixture');
const meanings = [
  ...entry[2].map((definition, i) => ({ id: String(i), definition })),
  {
    id: 'edge',
    definition:
      '（中文标点）最长匹配词语；running, unknown-word office affinity AVATAR. 行走在道路上。',
  },
];
let calls = 0;
let fail = false;
let held = true;
let release: (() => void) | undefined;
const provider = {
  search: () => Promise.resolve([]),
  getDetail: () => Promise.resolve(undefined),
  resolveEntry: async (word: string, signal?: AbortSignal) => {
    calls++;
    if (held)
      await new Promise<void>((r) => {
        release = r;
      });
    signal?.throwIfAborted();
    if (fail) {
      fail = false;
      throw new Error('Layout fixture failure');
    }
    return actualProvider.resolveEntry(word, signal);
  },
};
const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
const root = createRoot(element);
const render = (enabled = true) => {
  root.render(
    <DictionarySearchContent
      {...{ definitionWordPreviewEnabled: enabled }}
      word="行"
      meanings={meanings}
      provider={provider}
    />,
  );
};
Object.assign(globalThis, {
  layoutHarness: {
    render,
    hold: () => {
      held = true;
    },
    fail: () => {
      fail = true;
    },
    release: () => {
      held = false;
      release?.();
    },
    calls: () => calls,
    meanings,
  },
});
render(new URLSearchParams(location.search).get('enabled') !== '0');

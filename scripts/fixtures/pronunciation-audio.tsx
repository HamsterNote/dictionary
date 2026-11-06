import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { DictionaryContent } from '../../src/DictionaryContent';
import type {
  DictionaryCorrectionMap,
  DictionaryCorrectionPatch,
} from '../../src/dictionaryCorrections';
import type { DictionaryDataDetail } from '../../src/dictionaryData';
import {
  pronunciationAudioManifest,
  resolvePronunciationAudio,
} from '../../src/pronunciation-audio/index';
import {
  type PronunciationPlaybackController,
  type PronunciationPlaybackError,
  type PronunciationPlaybackState,
  pronunciationContextKey,
} from '../../src/pronunciation-audio/controller';
import type { PronunciationContext } from '../../src/pronunciation-audio/contracts';
import '../../src/dictionary.css';

const details: Record<string, DictionaryDataDetail> = {
  hello: {
    word: 'hello',
    phonetic: "hә'lәu",
    sources: [
      {
        id: 'fixture',
        label: 'Fixture',
        meanings: [{ id: 'hello-1', definition: 'hello apple' }],
      },
    ],
  },
  apple: {
    word: 'apple',
    phonetic: "'æpl",
    sources: [
      {
        id: 'fixture',
        label: 'Fixture',
        meanings: [{ id: 'apple-1', definition: 'apple hello' }],
      },
    ],
  },
};

const testState: {
  calls: PronunciationContext[];
  stopCount: number;
  mode: 'success' | 'loading' | PronunciationPlaybackError;
  finish: () => void;
} = {
  calls: [],
  stopCount: 0,
  mode: 'success',
  finish: () => {
    throw new Error('播放器尚未初始化');
  },
};
declare global {
  interface Window {
    __audioFixture: typeof testState;
  }
}
window.__audioFixture = testState;

function fakeController(): PronunciationPlaybackController {
  let state: PronunciationPlaybackState = { status: 'idle' };
  const listeners = new Set<(state: PronunciationPlaybackState) => void>();
  const publish = (next: PronunciationPlaybackState) => {
    state = next;
    listeners.forEach((listener) => {
      listener(state);
    });
  };
  testState.finish = () => {
    publish({ status: 'idle' });
  };
  return {
    resolve: (context) => resolvePronunciationAudio(pronunciationAudioManifest, context),
    play: (context) => {
      testState.calls.push(context);
      publish({ status: 'loading', contextKey: pronunciationContextKey(context) });
      if (testState.mode === 'success') {
        publish({ status: 'playing', contextKey: pronunciationContextKey(context) });
      } else if (testState.mode !== 'loading') {
        publish({
          status: 'error',
          contextKey: pronunciationContextKey(context),
          error: testState.mode,
        });
      }
      return Promise.resolve();
    },
    stop: () => {
      testState.stopCount += 1;
      publish({ status: 'idle' });
    },
    dispose: () => {
      listeners.clear();
    },
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function Fixture() {
  const [user, setUser] = useState<DictionaryCorrectionMap>({});
  const [controller] = useState(fakeController);
  const [legacyCalls] = useState<string[]>([]);
  const mode = new URLSearchParams(location.search).get('mode');
  const onChange = (word: string, patch: DictionaryCorrectionPatch | null) => {
    setUser((current) => ({ ...current, ...(patch === null ? {} : { [word]: patch }) }));
  };
  const detail = details['hello'];
  if (detail === undefined) throw new Error('hello fixture missing');
  return (
    <main>
      <button
        onClick={() => {
          setUser({ hello: { word: 'hello- edited' } });
        }}
      >
        模拟词头纠错
      </button>
      <button
        onClick={() => {
          setUser({ hello: { meaning: '仅修改释义' } });
        }}
      >
        模拟释义纠错
      </button>
      <button onClick={testState.finish}>结束播放</button>
      <DictionaryContent
        keyword="hello"
        corrections={{ user, onChange }}
        getDetail={(word) => details[word]}
        {...(detail.phonetic === undefined ? {} : { phonetic: detail.phonetic })}
        sources={detail.sources}
        {...(mode === 'legacy' ? {} : { pronunciation: controller })}
        {...(mode === 'legacy' || mode === 'dual'
          ? {
              pronounce: (word) => {
                legacyCalls.push(word);
                const output = document.querySelector('[data-testid="legacy-calls"]');
                if (output !== null) output.textContent = JSON.stringify(legacyCalls);
                return Promise.resolve();
              },
            }
          : {})}
      />
      <output data-testid="legacy-calls">{JSON.stringify(legacyCalls)}</output>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('root missing');
createRoot(root).render(<Fixture />);

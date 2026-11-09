import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { DictionaryContent } from '../../src/DictionaryContent';
import {
  DictionaryPronunciationOverlay,
  type PronunciationDisplayEntry,
} from '../../src/DictionaryPronunciationOverlay';
import type {
  DictionaryCorrectionMap,
  DictionaryCorrectionPatch,
} from '../../src/dictionaryCorrections';
import type { DictionaryDataDetail } from '../../src/dictionaryData';
import {
  type PronunciationAudioManifest,
  pronunciationAudioManifest,
  pronunciationPhoneticFingerprint,
  resolvePronunciationAudio,
} from '../../src/pronunciation-audio/index';
import {
  type PronunciationPlaybackController,
  type PronunciationPlaybackError,
  type PronunciationPlaybackState,
  pronunciationContextKey,
} from '../../src/pronunciation-audio/controller';
import type { PronunciationContext } from '../../src/pronunciation-audio/contracts';
import { knownScope, scopeWith } from '../../src/pronunciation-overlay/contracts';
import '../../src/dictionary.css';

const details: Record<string, DictionaryDataDetail> = {
  hello: {
    word: 'hello',
    phonetic: "/hә'lәu/",
    sources: [
      {
        id: 'fixture',
        label: 'Fixture',
        meanings: [{ id: 'hello-1', definition: 'hello cat' }],
      },
    ],
  },
  cat: {
    word: 'cat',
    phonetic: '/kæt/',
    sources: [
      {
        id: 'fixture',
        label: 'Fixture',
        meanings: [{ id: 'cat-1', definition: 'cat hello' }],
      },
    ],
  },
};

const testState: {
  calls: PronunciationContext[];
  resolves: PronunciationContext[];
  stopCount: number;
  mode: 'success' | 'loading' | PronunciationPlaybackError;
  finish: () => void;
} = {
  calls: [],
  resolves: [],
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

const overlayEntryId = 'ent_00000000-0000-4000-8000-000000000001';
const helloAudio = pronunciationAudioManifest.entries.find((entry) => entry.word === 'hello');
if (helloAudio === undefined) throw new Error('hello audio fixture missing');
const overlayManifest: PronunciationAudioManifest = {
  ...pronunciationAudioManifest,
  entries: [
    {
      ...helloAudio,
      phonetic: '/overlay/',
      phoneticFingerprint: pronunciationPhoneticFingerprint('/overlay/'),
      scope: {
        kind: 'entry',
        entryId: overlayEntryId,
        role: 'base',
        readingRef: 'overlay-reading',
      },
    },
  ],
};

function overlayEntries(phonetic: string): readonly PronunciationDisplayEntry[] {
  return [
    {
      entryId: overlayEntryId,
      word: 'hello',
      role: 'base',
      conditions: scopeWith({
        language: knownScope(['en']),
        entry: knownScope([overlayEntryId]),
        role: knownScope(['base']),
      }),
      readings: [
        {
          schema: 'pronunciation-display/1',
          entryId: overlayEntryId,
          word: 'hello',
          role: 'base',
          originalIpa: phonetic,
          notation: 'phonemic',
          accent: { class: 'uk-unspecified', label: 'UK', unspecified: false },
          usage: [],
          tier: 'default',
          reviewStatus: 'active',
          origin: 'qualified-source',
          attribution: {
            pageUrl: 'https://fixture.invalid/overlay',
            historyUrl: 'https://fixture.invalid/history',
            licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
            licenseSpdx: 'CC-BY-SA-4.0',
            changeNotice: 'Synthetic overlay fixture',
          },
          synthetic: true,
        },
      ],
    },
  ];
}

function fakeController(manifest: PronunciationAudioManifest): PronunciationPlaybackController {
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
    resolve: (context) => {
      testState.resolves.push(context);
      return resolvePronunciationAudio(manifest, context);
    },
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
  const mode = new URLSearchParams(location.search).get('mode');
  const [user, setUser] = useState<DictionaryCorrectionMap>({});
  const [overlayPhonetic, setOverlayPhonetic] = useState('/overlay/');
  const [controller] = useState(() =>
    fakeController(mode === 'overlay' ? overlayManifest : pronunciationAudioManifest),
  );
  const [legacyCalls] = useState<string[]>([]);
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
      {mode === 'overlay' ? (
        <button
          onClick={() => {
            setOverlayPhonetic('/overlay-changed/');
          }}
        >
          切换 overlay 读法
        </button>
      ) : null}
      <button onClick={testState.finish}>结束播放</button>
      <DictionaryContent
        keyword="hello"
        corrections={{ user, onChange }}
        getDetail={(word) => details[word]}
        {...(detail.phonetic === undefined ? {} : { phonetic: detail.phonetic })}
        sources={detail.sources}
        {...(mode === 'overlay'
          ? {
              pronunciationOverlay: (
                <DictionaryPronunciationOverlay entries={overlayEntries(overlayPhonetic)} />
              ),
            }
          : {})}
        {...(mode === 'legacy' || mode === 'none' ? {} : { pronunciation: controller })}
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

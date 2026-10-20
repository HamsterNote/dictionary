import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DictionaryPronunciationOverlay,
  type PronunciationDisplayEntry,
} from '../../src/DictionaryPronunciationOverlay';
import { DictionaryContent } from '../../src/DictionaryContent';
import {
  knownScope,
  scopeWith,
  type GrammarRole,
  type PronunciationDisplayDto,
} from '../../src/pronunciation-overlay/contracts';
import type { ScopedCorrection } from '../../src/pronunciation-overlay/corrections';
import '../../src/dictionary.css';

// 夹具词必须没有任何系统规则/行内纠错，否则 overlay 会按合同阻断（见 legacy.ts）。
const fixtureWord = 'syntheticfixture';
const roles: GrammarRole[] = ['base', 'present', 'past', 'past-participle'];
const entries: PronunciationDisplayEntry[] = roles.map((role, index) => {
  const entryId = `ent_0000000${String(index + 1)}-0000-4000-8000-000000000001`;
  const conditions = scopeWith({
    language: knownScope(['en']),
    entry: knownScope([entryId]),
    lexeme: knownScope(['lex_11111111-0000-4000-8000-000000000001']),
    role: knownScope([role]),
    pos: knownScope(['verb']),
    sense: knownScope(['synthetic-sense']),
    accent: knownScope(['unspecified']),
    other: knownScope(['unrestricted']),
  });
  const reading: PronunciationDisplayDto = {
    schema: 'pronunciation-display/1',
    entryId,
    word: fixtureWord,
    role,
    originalIpa: index > 1 ? '[x]' : '/x/',
    notation: index > 1 ? 'phonetic' : 'phonemic',
    accent: { class: 'unspecified', label: '未注明口音', unspecified: true },
    usage: index === 2 ? ['rare'] : [],
    tier: 'default',
    reviewStatus: index === 0 ? 'due' : index === 1 ? 'pending-review' : 'active',
    origin: 'qualified-source',
    attribution: {
      pageUrl: 'https://fixture.invalid/wiki/syntheticfixture',
      historyUrl: 'https://fixture.invalid/w/index.php?title=syntheticfixture&action=history',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      licenseSpdx: 'CC-BY-SA-4.0',
      changeNotice: 'Synthetic fixture; no real source pronunciation asserted.',
    },
    synthetic: true,
  };
  return {
    entryId,
    word: fixtureWord,
    role,
    conditions,
    readings: [
      reading,
      {
        ...reading,
        originalIpa: '/regional/',
        tier: 'supplemental',
        accent: { class: 'regional', label: 'Scotland', region: 'Scotland', unspecified: false },
        usage: ['archaic'],
      },
      { ...reading, originalIpa: '/fragment', tier: 'evidence-only' },
    ],
  };
});
export function Fixture() {
  const [values, setValues] = useState<readonly ScopedCorrection[]>([]);
  const [fail, setFail] = useState(false);
  const [verified, setVerified] = useState('');
  const [spoken, setSpoken] = useState('');
  const params = new URLSearchParams(location.search);
  const blocked = params.has('blocked');
  const readOnly = params.has('readonly');
  return (
    <main
      style={{
        width: 'min(100%, 620px)',
        margin: '20px auto',
        padding: 12,
        boxSizing: 'border-box',
      }}
    >
      <label>
        <input
          type="checkbox"
          checked={fail}
          onChange={(event) => {
            setFail(event.target.checked);
          }}
        />
        模拟持久化失败
      </label>
      <output
        style={{ display: 'block', overflowWrap: 'anywhere', fontSize: 11 }}
        data-testid="saved"
      >
        {JSON.stringify(values)}
      </output>
      <output data-testid="verified">{verified}</output>
      <output data-testid="spoken">{spoken}</output>
      <DictionaryContent
        keyword={fixtureWord}
        meanings={[{ id: fixtureWord, definition: 'Synthetic fixture' }]}
        phonetic="/old/"
        corrections={{
          user: blocked ? { [fixtureWord]: { phonetic: '/legacy/' } } : {},
        }}
        pronounce={async (word) => {
          await Promise.resolve();
          setSpoken(word);
        }}
        pronunciationCandidates={<p>synthetic candidate only</p>}
        pronunciationOverlay={
          <DictionaryPronunciationOverlay
            entries={entries}
            corrections={
              readOnly
                ? { values }
                : {
                    values,
                    onChange: async (next) => {
                      await Promise.resolve();
                      if (fail) throw new Error('synthetic storage failure');
                      setValues(next);
                    },
                  }
            }
            onVerify={
              readOnly
                ? undefined
                : async (entryId) => {
                    await Promise.resolve();
                    setVerified(entryId);
                  }
            }
          />
        }
      />
    </main>
  );
}
const root = document.getElementById('root');
if (root === null) throw new Error('Missing fixture root');
createRoot(root).render(<Fixture />);

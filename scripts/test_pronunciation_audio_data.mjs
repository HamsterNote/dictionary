import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  assert.equal(typeof globalThis.Worker, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const audio = await server.ssrLoadModule('/src/pronunciation-audio/index.ts');
  const {
    parsePronunciationAudioManifest,
    pronunciationAudioManifest,
    pronunciationPhoneticFingerprint,
    resolvePronunciationAudio,
  } = audio;
  assert.equal(pronunciationAudioManifest.manifestVersion, 'pronunciation-audio/1');

  const asset = {
    assetId: 'commons-synthetic',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Synthetic.ogg',
    revisionId: 123,
    digest: '0123456789abcdef0123456789abcdef01234567',
    metadataSha256: 'b'.repeat(64),
    author: 'Fixture Author',
    license: {
      spdx: 'CC-BY-4.0',
      name: 'Creative Commons Attribution 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
    },
    changes: '合成测试数据，未修改音频',
    media: [
      {
        url: 'https://upload.wikimedia.org/synthetic.ogg',
        mime: 'audio/ogg',
        bytes: 1024,
        durationSeconds: 1,
      },
    ],
  };
  const evidence = {
    wiktionaryPageUrl: 'https://en.wiktionary.org/wiki/read',
    wiktionaryRevisionId: 456,
    sourcePhonetic: '/ɹiːd/',
    responseSha256: 'a'.repeat(64),
    association: 'wiktionary-pronunciation-section',
    branch: {
      relation: 'ancestor',
      ipaLine: 1,
      audioLine: 2,
      ipaAccents: ['RP'],
      audioAccents: ['UK'],
    },
    verifiedAt: '2026-11-06T00:00:00Z',
    verifiedBy: 'synthetic test',
    reviewNote: '合成映射仅用于匹配测试',
  };
  const entry = (overrides = {}) => ({
    word: 'read',
    language: 'en',
    phonetic: 'ri:d',
    phoneticFingerprint: pronunciationPhoneticFingerprint('ri:d'),
    accent: 'uk',
    scope: { kind: 'legacy-unique', verified: true },
    assetId: asset.assetId,
    evidence,
    ...overrides,
  });
  const manifest = (entries) => ({
    manifestVersion: 'pronunciation-audio/1',
    generatedAt: '2026-11-06T00:00:00Z',
    entries,
    assets: [asset],
  });
  const context = (overrides = {}) => ({
    word: 'read',
    language: 'en',
    phonetic: 'ri:d',
    ...overrides,
  });

  const roundTrip = parsePronunciationAudioManifest(
    JSON.parse(JSON.stringify(manifest([entry()]))),
  );
  assert.deepEqual(roundTrip, manifest([entry()]));
  assert.equal(resolvePronunciationAudio(roundTrip, context()).status, 'available');

  const roles = manifest([
    entry({
      scope: {
        kind: 'entry',
        entryId: 'ent_00000000-0000-4000-8000-000000000001',
        role: 'base',
        readingRef: 'reading-base',
      },
    }),
    entry({
      phonetic: 'rɛd',
      phoneticFingerprint: pronunciationPhoneticFingerprint('rɛd'),
      scope: {
        kind: 'entry',
        entryId: 'ent_00000000-0000-4000-8000-000000000002',
        role: 'past',
        readingRef: 'reading-past',
      },
    }),
  ]);
  assert.deepEqual(resolvePronunciationAudio(roles, context()), {
    status: 'unavailable',
    reason: 'scope-unknown',
  });
  assert.equal(
    resolvePronunciationAudio(
      roles,
      context({
        entryId: 'ent_00000000-0000-4000-8000-000000000001',
        role: 'base',
      }),
    ).status,
    'available',
  );

  assert.deepEqual(
    resolvePronunciationAudio(roundTrip, context({ word: 'Read' })).status,
    'available',
  );
  assert.deepEqual(resolvePronunciationAudio(roundTrip, context({ word: 'reading' })), {
    status: 'unavailable',
    reason: 'not-found',
  });
  assert.deepEqual(resolvePronunciationAudio(roundTrip, context({ phonetic: 'rɛd' })), {
    status: 'unavailable',
    reason: 'reading-mismatch',
  });
  assert.deepEqual(resolvePronunciationAudio(roundTrip, context({ language: 'zh' })), {
    status: 'unavailable',
    reason: 'unsupported-language',
  });

  const accents = manifest([entry(), entry({ accent: 'us', assetId: asset.assetId })]);
  assert.deepEqual(resolvePronunciationAudio(accents, context()), {
    status: 'unavailable',
    reason: 'accent-unknown',
  });
  assert.equal(resolvePronunciationAudio(accents, context({ accent: 'uk' })).status, 'available');
  assert.deepEqual(resolvePronunciationAudio(roundTrip, context({ accent: 'us' })), {
    status: 'unavailable',
    reason: 'accent-mismatch',
  });

  assert.throws(() =>
    parsePronunciationAudioManifest(
      manifest([entry({ scope: { kind: 'unknown', reason: '不得猜测' } })]),
    ),
  );
  const before = JSON.stringify(roundTrip);
  resolvePronunciationAudio(roundTrip, context({ phonetic: 'changed' }));
  assert.equal(JSON.stringify(roundTrip), before);
  assert.equal('meaning' in context(), false);

  const { resolveOverlayPronunciationContext } = await server.ssrLoadModule(
    '/src/pronunciationOverlayPlayback.ts',
  );
  const overlayEntry = {
    entryId: 'ent_00000000-0000-4000-8000-000000000001',
    word: 'hello',
    role: 'base',
    conditions: { language: { kind: 'known', values: ['en'] } },
    readings: [
      {
        entryId: 'ent_00000000-0000-4000-8000-000000000001',
        word: 'hello',
        role: 'base',
        originalIpa: '/həˈləʊ/',
        tier: 'default',
        accent: { class: 'uk-unspecified', unspecified: false },
      },
    ],
  };
  assert.deepEqual(resolveOverlayPronunciationContext([overlayEntry]), {
    word: 'hello',
    language: 'en',
    phonetic: '/həˈləʊ/',
    entryId: 'ent_00000000-0000-4000-8000-000000000001',
    role: 'base',
    accent: 'uk',
  });
  assert.equal(resolveOverlayPronunciationContext([]), undefined);
  assert.equal(
    resolveOverlayPronunciationContext([
      overlayEntry,
      { ...overlayEntry, entryId: 'ent_00000000-0000-4000-8000-000000000002' },
    ]),
    undefined,
  );
  assert.equal(
    resolveOverlayPronunciationContext([
      {
        ...overlayEntry,
        readings: [{ ...overlayEntry.readings[0], tier: 'supplemental' }],
      },
    ]),
    undefined,
  );

  console.log('test_pronunciation_audio_data: OK');
} finally {
  await server.close();
}

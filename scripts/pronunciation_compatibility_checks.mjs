import assert from 'node:assert/strict';
import { makeFixture } from './pronunciation_test_fixture.mjs';

async function modules(server) {
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
  const identity = await server.ssrLoadModule('/src/pronunciation-overlay/identity.ts');
  return { contracts, identity };
}

export async function checkOverlayCorrections(server) {
  const { contracts, identity } = await modules(server);
  const f = makeFixture(contracts, identity);
  const { createLocalCorrectionsCache } = await server.ssrLoadModule(
    '/src/useDictionaryCorrections.ts',
  );
  const preservedCache = createLocalCorrectionsCache({
    load: () => ({ read: { phonetic: '/old/' } }),
    loadForOverlay: () => {
      throw new Error('strict read failed');
    },
    save: () => {
      throw new Error('read-only test');
    },
  });
  assert.deepEqual(preservedCache.patches, { read: { phonetic: '/old/' } });
  assert.match(preservedCache.loadError.message, /strict read failed/u);
  const { adaptLegacyCorrections, legacyProtection, protectPublishedWord, readLegacyState } =
    await server.ssrLoadModule('/src/pronunciation-overlay/legacy.ts');
  const {
    createScopedCorrectionStore,
    submitScopedCorrection,
    canEditScopedCorrections,
    SCOPED_CORRECTION_STORAGE_KEY,
  } = await server.ssrLoadModule('/src/pronunciation-overlay/corrections.ts');
  const map = {
    READ: { word: 'Read', meaning: 'meaning', phonetic: '' },
    other: { meaning: 'only meaning' },
  };
  const before = structuredClone(map);
  const records = adaptLegacyCorrections(map, 'user');
  assert.deepEqual(map, before);
  assert.equal(records[0].key, 'READ');
  assert.equal(records[0].rule.operations.find((op) => op.field === 'phonetic').op, 'suppress');
  assert.ok(
    Object.values(records[0].rule.conditions).every((condition) => condition.kind === 'unknown'),
  );
  assert.equal(records[0].rule.createdAt, undefined);
  assert.equal(records[0].rule.lastVerifiedAt, undefined);
  assert.equal(records[0].rule.reviewStatus, 'pending-review');
  const state = { status: 'ready', user: map, system: {} };
  assert.equal(legacyProtection('read', state, []).length, 1);
  assert.equal(legacyProtection('other', state, []).length, 0);
  const resolution = {
    key: 'READ',
    origin: 'user',
    patchFingerprint: records[0].fingerprint,
    entryId: f.entryId,
    scope: f.scope(),
    confirmedBy: 'synthetic-user',
    confirmedAt: '2026-10-17T00:00:00Z',
    operation: 'confirm-scope',
  };
  assert.equal(legacyProtection('read', state, [resolution]).length, 0);
  assert.equal(
    legacyProtection('read', { ...state, user: { READ: { phonetic: '/changed/' } } }, [resolution])
      .length,
    1,
  );
  assert.equal(
    legacyProtection('read', state, [
      { ...resolution, scope: f.scope({ role: contracts.unknownScope('unknown') }) },
    ]).length,
    1,
  );
  for (const failed of [
    readLegacyState({
      getItem() {
        throw new Error('denied');
      },
    }),
    readLegacyState({ getItem: () => '{bad' }),
    readLegacyState({ getItem: () => '[]' }),
    readLegacyState({ getItem: () => '{"read":{"phonetic":null}}' }),
  ]) {
    assert.equal(failed.status, 'failed');
    const guarded = protectPublishedWord({
      word: 'read',
      legacy: failed,
      resolutions: [],
      current: 'old',
      published: 'new',
      candidates: 'candidate',
    });
    assert.equal(guarded.current, 'old');
    assert.equal(guarded.candidates, 'candidate');
    assert.ok(guarded.blockedReasons.length);
  }
  assert.equal(readLegacyState({ getItem: () => null }).status, 'ready');
  assert.equal(
    protectPublishedWord({
      word: 'read',
      legacy: state,
      resolutions: [],
      current: 'v1',
      published: 'global',
      candidates: 'candidate',
    }).current,
    'v1',
  );
  assert.equal(
    protectPublishedWord({
      word: 'other',
      legacy: state,
      resolutions: [],
      current: 'old',
      published: 'global',
      candidates: 'candidate',
    }).current,
    'global',
  );
  const correction = { entryId: f.entryId, conditions: f.scope(), phonetic: '' };
  assert.equal(canEditScopedCorrections({ values: [] }), false);
  await assert.rejects(() => submitScopedCorrection({ values: [] }, correction), /回调/u);
  const host = {
    values: [],
    onChange: async () => {
      throw new Error('host failed');
    },
  };
  await assert.rejects(() => submitScopedCorrection(host, correction), /host failed/u);
  assert.deepEqual(host.values, []);
  let submitted;
  await submitScopedCorrection(
    {
      values: [],
      onChange: async (values) => {
        submitted = values;
      },
    },
    correction,
  );
  assert.deepEqual(submitted, [correction]);
  let writes = 0;
  let raw = null;
  let fail = false;
  const store = createScopedCorrectionStore({
    getItem: (key) => {
      assert.equal(key, SCOPED_CORRECTION_STORAGE_KEY);
      return raw;
    },
    setItem: (key, value) => {
      assert.equal(key, SCOPED_CORRECTION_STORAGE_KEY);
      writes++;
      if (fail) throw new Error('quota');
      raw = value;
    },
  });
  assert.deepEqual(store.load(), []);
  assert.equal(writes, 0);
  store.save([correction]);
  assert.deepEqual(store.load(), [correction]);
  fail = true;
  assert.throws(() => store.save([]), /quota/u);
  assert.deepEqual(store.load(), [correction]);
  await assert.rejects(() =>
    submitScopedCorrection(
      { values: [], onChange: () => {} },
      {
        ...correction,
        conditions: f.scope({ entry: contracts.knownScope([f.ids.present ?? 'wrong']) }),
      },
    ),
  );
  console.log('overlay correction compatibility: OK');
}

export async function checkOverlayQueries(server) {
  const { contracts, identity } = await modules(server);
  const { createPronunciationQuery } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/query.ts',
  );
  const empty = { legacy: { status: 'ready', user: {}, system: {} }, resolutions: [] };
  const f = makeFixture(contracts, identity);
  const query = createPronunciationQuery(f.snapshot, empty);
  assert.deepEqual(query.lookup('READ').entryIds, [f.entryId]);
  assert.equal(query.getEntryById(f.entryId).readings[0].originalIpa, '/x/');
  assert.doesNotThrow(() => JSON.stringify(query.getEntryById(f.entryId)));
  assert.equal(query.legacyProjection('read', '/old/'), '/x/');
  assert.equal(query.legacyProjection('read', '/host/', { hostOwned: true }), '/host/');
  // Host mutation cannot create a mixed snapshot.
  f.documents.displays[0].originalIpa = '/changed/';
  assert.equal(query.getEntryById(f.entryId).readings[0].originalIpa, '/x/');
  const four = makeFixture(contracts, identity, { fourRoles: true });
  const multi = createPronunciationQuery(four.snapshot, empty);
  assert.equal(multi.lookup('read').entryIds.length, 4);
  assert.equal(multi.legacyProjection('read', '/old/'), '/old/');
  const verified = {
    manifestVersion: multi.manifestVersion,
    entryId: four.entryId,
    phonetic: '/x/',
    explicitlyVerified: true,
  };
  assert.equal(multi.legacyProjection('read', '/old/', { verifiedProjection: verified }), '/x/');
  assert.equal(
    multi.legacyProjection('read', '/old/', {
      verifiedProjection: { ...verified, manifestVersion: 'stale' },
    }),
    '/old/',
  );
  const reverse = structuredClone(four.snapshot);
  reverse.identity.byId = Object.fromEntries(Object.entries(reverse.identity.byId).reverse());
  assert.equal(createPronunciationQuery(reverse, empty).legacyProjection('read', '/old/'), '/old/');
  const phonetic = makeFixture(contracts, identity);
  phonetic.documents.observations[0] = {
    ...phonetic.observation,
    rawIpa: '[x]',
    normalizedIpa: '[x]',
    notation: 'phonetic',
  };
  phonetic.documents.displays[0] = {
    ...phonetic.display,
    originalIpa: '[x]',
    notation: 'phonetic',
  };
  phonetic.documents.manifest.compatibleProjection[0] = {
    entryId: phonetic.entryId,
    legacyWord: 'read',
    phonetic: '[x]',
    notation: 'phonetic',
  };
  assert.equal(
    createPronunciationQuery(phonetic.snapshot, empty).legacyProjection('read', '/old/'),
    '[x]',
  );
  const blocked = createPronunciationQuery(four.snapshot, {
    legacy: { status: 'ready', user: { read: { phonetic: '' } }, system: {} },
    resolutions: [],
  });
  assert.deepEqual(blocked.getEntryById(four.entryId).readings, []);
  assert.equal(blocked.legacyProjection('read', '', { verifiedProjection: verified }), '');
  const failed = createPronunciationQuery(four.snapshot, {
    legacy: { status: 'failed', reason: 'storage denied' },
    resolutions: [],
  });
  assert.deepEqual(failed.getEntryById(four.entryId).readings, []);
  const candidate = { ...four.snapshot, kind: 'candidate' };
  assert.throws(() => createPronunciationQuery(candidate, empty));
  for (const damage of [
    (snapshot) => {
      snapshot.documents.resolved[0].conditions.role = contracts.knownScope(['past']);
    },
    (snapshot) => {
      snapshot.documents.displays[0].accent.class = 'uk-unspecified';
    },
    (snapshot) => {
      snapshot.documents.displays[0].attribution.pageUrl = 'javascript:alert(1)';
    },
    (snapshot) => {
      snapshot.documents.rules = [four.rule()];
    },
    (snapshot) => {
      snapshot.documents.approvals[0].includedHeads = [];
      snapshot.documents.approvals[0].excludedHeads = ['read'];
    },
  ]) {
    const damaged = structuredClone(four.snapshot);
    damage(damaged);
    assert.throws(() => createPronunciationQuery(damaged, empty));
  }
  const { adaptLegacyCorrections } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/legacy.ts',
  );
  const user = { read: { phonetic: '/v1/' } };
  const resolution = {
    key: 'read',
    origin: 'user',
    patchFingerprint: adaptLegacyCorrections(user, 'user')[0].fingerprint,
    entryId: four.entryId,
    scope: four.scope(),
    confirmedBy: 'synthetic-user',
    confirmedAt: '2026-10-17T00:00:00Z',
    operation: 'confirm-scope',
  };
  const unrepresented = createPronunciationQuery(four.snapshot, {
    legacy: { status: 'ready', user, system: {} },
    resolutions: [resolution],
  });
  assert.deepEqual(unrepresented.getEntryById(four.entryId).readings, []);
  assert.equal(
    unrepresented.legacyProjection('read', '/v1/', { verifiedProjection: verified }),
    '/v1/',
  );
  const preserved = structuredClone(four.snapshot);
  preserved.documents.rules = [
    four.rule({ operations: [{ field: 'phonetic', op: 'set', value: '/v1/' }] }),
  ];
  preserved.documents.displays[0] = { ...four.display, origin: 'user', originalIpa: '/v1/' };
  preserved.documents.manifest.compatibleProjection[0].phonetic = '/v1/';
  assert.equal(
    createPronunciationQuery(preserved, {
      legacy: { status: 'ready', user, system: {} },
      resolutions: [resolution],
    }).getEntryById(four.entryId).readings[0].originalIpa,
    '/v1/',
  );
  console.log('overlay opt-in query compatibility: OK');
}

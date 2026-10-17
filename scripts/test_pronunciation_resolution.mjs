import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { makeFixture } from './pronunciation_test_fixture.mjs';
const server = await createServer({
  logLevel: 'error',
  server: { middlewareMode: true, ws: false },
});
try {
  const contracts = await server.ssrLoadModule('/src/pronunciation-overlay/contracts.ts');
  const identity = await server.ssrLoadModule('/src/pronunciation-overlay/identity.ts');
  const { resolveEntry, selectEffectiveReadings } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/resolve.ts',
  );
  const f = makeFixture(contracts, identity);
  const old = {
    ref: 'legacy',
    ipa: '/old/',
    scope: f.scope(),
    tier: 'default',
    provenance: { field: 'phonetic', source: 'legacy' },
  };
  const input = {
    entryId: f.entryId,
    scope: f.scope(),
    legacyFields: { word: 'read', meaning: 'legacy', phonetic: '/old/' },
    previousReadings: [old],
    observations: [f.observation],
    evidence: [f.evidence],
    rules: [],
  };
  const source = resolveEntry(input);
  assert.equal(source.readings.find((r) => r.ref === old.ref).tier, 'retained');
  assert.equal(source.readings.find((r) => r.ref === f.observation.observationId).tier, 'default');
  assert.equal(source.fields.meaning, 'legacy');
  assert.equal(source.fields.phonetic, '/x/');
  const priorManual = {
    ...old,
    ref: 'prior-user',
    ipa: '/manual/',
    provenance: { field: 'phonetic', source: 'user', ref: 'prior-user' },
  };
  const preservedManual = resolveEntry({ ...input, previousReadings: [priorManual] });
  assert.equal(
    preservedManual.readings.find((reading) => reading.ref === f.observation.observationId).tier,
    'retained',
  );
  assert.equal(preservedManual.fields.phonetic, '/manual/');
  const revoked = resolveEntry({
    ...input,
    previousReadings: [priorManual],
    rules: [f.rule({ ruleId: 'prior-user', reviewStatus: 'revoked' })],
  });
  assert.equal(revoked.fields.phonetic, '/x/');
  const unspecified = resolveEntry({
    ...input,
    scope: f.scope({ accent: contracts.knownScope(['unspecified']) }),
    observations: [
      {
        ...f.observation,
        rawTags: [],
        applicability: f.scope({ accent: contracts.unknownScope('unmarked') }),
      },
    ],
  });
  assert.equal(
    unspecified.readings.find((reading) => reading.ref === f.observation.observationId).tier,
    'default',
  );
  assert.deepEqual(
    unspecified.readings.find((reading) => reading.ref === f.observation.observationId).scope.accent
      .values,
    ['unspecified'],
  );
  const variants = resolveEntry({
    ...input,
    observations: [f.observation, { ...f.observation, observationId: 'second', rawIpa: '/y/' }],
  });
  assert.equal(variants.readings.filter((r) => r.tier === 'default').length, 2);
  const sys = f.rule({
    ruleId: 'system',
    origin: 'system',
    operations: [
      { field: 'meaning', op: 'set', value: 'system meaning' },
      { field: 'phonetic', op: 'set', value: '/s/' },
    ],
  });
  const user = f.rule({ ruleId: 'user', reviewStatus: 'due' });
  const result = resolveEntry({ ...input, rules: [user, sys] });
  assert.equal(result.fields.phonetic, '/u/');
  assert.equal(result.fields.meaning, 'system meaning');
  assert.equal(result.fieldProvenance.find((p) => p.field === 'phonetic').source, 'user');
  assert.equal(result.fieldProvenance.find((p) => p.field === 'meaning').source, 'system');
  for (const status of ['failed', 'missing', 'no-qualified', 'fewer-readings']) {
    const unchanged = resolveEntry({
      ...input,
      observations: [],
      previousReadings: source.readings,
      status,
    });
    assert.deepEqual(unchanged.readings, source.readings);
  }
  const broader = f.scope({ accent: contracts.knownScope(['UK', 'US']) });
  const partial = resolveEntry({
    ...input,
    scope: broader,
    previousReadings: [{ ...old, scope: broader }],
  });
  assert.ok(
    partial.readings.some(
      (r) => r.ref === old.ref && r.tier === 'default' && r.scope.accent.values.join() === 'UK',
    ),
  );
  const openScope = f.scope({ accent: contracts.explicitAllScope([f.evidence.evidenceId]) });
  const openPartial = resolveEntry({
    ...input,
    scope: openScope,
    previousReadings: [{ ...old, scope: openScope }],
  });
  assert.equal(selectEffectiveReadings(openPartial.readings, f.scope())[0].ipa, '/x/');
  assert.equal(
    selectEffectiveReadings(
      openPartial.readings,
      f.scope({ accent: contracts.knownScope(['UK']) }),
    )[0].ipa,
    '/old/',
  );
  const noGuess = resolveEntry({
    ...input,
    observations: [
      { ...f.observation, applicability: f.scope({ role: contracts.unknownScope('unknown') }) },
    ],
  });
  assert.equal(noGuess.readings[0].tier, 'default');
  assert.equal(noGuess.readings[1].tier, 'unresolved');
  const suppressed = resolveEntry({
    ...input,
    rules: [f.rule({ operations: [{ field: 'phonetic', op: 'suppress' }] })],
  });
  assert.equal(suppressed.fields.phonetic, '');
  assert.equal(suppressed.readings.at(-1).reason, '明确范围内有意清空');
  const exclusion = {
    readingRef: old.ref,
    scope: f.scope(),
    evidenceRefs: [f.evidence.evidenceId],
    reason: 'synthetic confirmed error',
    confirmed: true,
  };
  assert.equal(
    resolveEntry({ ...input, observations: [], confirmedExclusions: [exclusion] }).readings[0].tier,
    'excluded',
  );
  assert.equal(
    resolveEntry({
      ...input,
      observations: [],
      confirmedExclusions: [{ ...exclusion, confirmed: false }],
    }).readings[0].tier,
    'default',
  );
  assert.equal(
    resolveEntry({
      ...input,
      observations: [],
      confirmedExclusions: [{ ...exclusion, evidenceRefs: [] }],
    }).readings[0].tier,
    'default',
  );
  assert.equal(
    resolveEntry({ ...input, evidence: [{ ...f.evidence, license: { spdx: 'MIT' } }] }).readings[1]
      .tier,
    'unresolved',
  );
  assert.throws(() =>
    resolveEntry({
      ...input,
      rules: [f.rule({ operations: [{ field: 'phonetic', op: 'set', value: '' }] })],
    }),
  );
  const four = makeFixture(contracts, identity, { fourRoles: true });
  for (const role of identity.READ_ROLE_ORDER) {
    const id = four.ids[role];
    const roleScope = four.scope({
      entry: contracts.knownScope([id]),
      role: contracts.knownScope([role]),
    });
    const correction = four.rule({ target: { kind: 'entry', entryId: id }, conditions: roleScope });
    for (const other of identity.READ_ROLE_ORDER) {
      const otherId = four.ids[other];
      const resolved = resolveEntry({
        ...input,
        entryId: otherId,
        scope: four.scope({
          entry: contracts.knownScope([otherId]),
          role: contracts.knownScope([other]),
        }),
        observations: [],
        rules: [correction],
      });
      assert.equal(resolved.fields.phonetic, other === role ? '/u/' : '/old/');
    }
  }
  console.log(
    'test_pronunciation_resolution: OK (precedence, finite partial scopes, preservation, exclusions, four roles)',
  );
} finally {
  await server.close();
}

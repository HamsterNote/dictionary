import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  logLevel: 'error',
});
try {
  const {
    decodeDictionaryPreferences: decode,
    createDictionaryPreferencesStore: create,
    DICTIONARY_PREFERENCES_KEY: key,
  } = await server.ssrLoadModule('/src/dictionaryPreferences.ts');
  assert.equal(decode(null).definitionWordPreviewEnabled, true);
  assert.equal(decode('{"version":1}').definitionWordPreviewEnabled, true);
  assert.equal(
    decode('{"version":1,"definitionWordPreviewEnabled":false}').definitionWordPreviewEnabled,
    false,
  );
  for (const raw of [
    'broken',
    '{"version":2}',
    '{"version":1,"definitionWordPreviewEnabled":"false"}',
  ])
    assert.throws(() => decode(raw));
  let saved = '{"version":1,"definitionWordPreviewEnabled":false}',
    writes = 0,
    fail = false;
  const store = create({
    getItem: (k) => {
      assert.equal(k, key);
      return saved;
    },
    setItem: (k, v) => {
      assert.equal(k, key);
      writes++;
      if (fail) throw Error('disk');
      saved = v;
    },
  });
  await store.load();
  assert.equal(store.getSnapshot().enabled, false);
  await store.setEnabled(true);
  assert.equal(decode(saved).definitionWordPreviewEnabled, true);
  fail = true;
  await store.setEnabled(false);
  assert.equal(store.getSnapshot().enabled, false);
  assert.equal(store.getSnapshot().unsaved, true);
  fail = false;
  await store.retry();
  assert.equal(decode(saved).definitionWordPreviewEnabled, false);
  assert.equal(store.getSnapshot().unsaved, false);
  let resolveRead;
  const late = create({
    getItem: () => new Promise((r) => (resolveRead = r)),
    setItem: (_k, v) => {
      saved = v;
    },
  });
  const read = late.load();
  await late.setEnabled(false);
  resolveRead(null);
  await read;
  assert.equal(late.getSnapshot().enabled, false);
  const corrupt = create({
    getItem: () => '{"version":2}',
    setItem: () => {
      throw Error('must not overwrite');
    },
  });
  await corrupt.load();
  assert.equal(corrupt.getSnapshot().enabled, true);
  assert.ok(corrupt.getSnapshot().error);
  const denied = create({
    getItem: () => {
      throw Error('denied');
    },
    setItem: () => {},
  });
  await denied.load();
  assert.equal(denied.getSnapshot().status, 'error');
  console.log(
    `Preference decoder, false hydration, stale read, write/retry and corrupt-record preservation passed (${writes} writes).`,
  );
} finally {
  await server.close();
}

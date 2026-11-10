import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });
const originalIdle = globalThis.requestIdleCallback;
const originalCancel = globalThis.cancelIdleCallback;
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const callbacks = new Map();
let sequence = 0;
globalThis.requestIdleCallback = (callback) => {
  callbacks.set(++sequence, callback);
  return sequence;
};
globalThis.cancelIdleCallback = (id) => callbacks.delete(id);

async function tick() {
  const [id, callback] = callbacks.entries().next().value ?? [];
  assert.ok(callback, 'expected an idle slice');
  callbacks.delete(id);
  callback({ didTimeout: false, timeRemaining: () => 50 });
  await setImmediate();
}
async function drain() {
  for (let turn = 0; callbacks.size > 0 && turn < 100; turn += 1) await tick();
  assert.equal(callbacks.size, 0, 'queue must drain');
}

try {
  const { resolveDictionaryTextEntries, resolveDictionaryTextTask } = await server.ssrLoadModule(
    '/src/dictionaryTextCandidates.ts',
  );
  const calls = [];
  let active = 0;
  let maximum = 0;
  let release;
  const resolver = async (word) => {
    calls.push(word);
    active += 1;
    maximum = Math.max(maximum, active);
    if (word === 'first')
      await new Promise((resolve) => {
        release = resolve;
      });
    active -= 1;
    return { word, definition: word };
  };
  const first = resolveDictionaryTextEntries('first second first', resolver);
  const second = resolveDictionaryTextEntries('third fourth', resolver);
  assert.deepEqual(calls, [], 'do not resolve synchronously before idle');
  await tick();
  assert.deepEqual(calls, ['first'], 'one in-flight call across readers');
  release();
  await setImmediate();
  await drain();
  const maps = await Promise.all([first, second]);
  assert.equal(maximum, 1);
  assert.deepEqual(calls, ['first', 'second', 'third', 'fourth']);
  assert.deepEqual([...maps[0].keys()], ['first', 'second']);

  const pending = new AbortController();
  const cancelled = resolveDictionaryTextEntries('never', resolver, pending.signal);
  const rejected = assert.rejects(cancelled, /abort/iu);
  pending.abort();
  await rejected;
  assert.equal(callbacks.size, 0, 'cancel the scheduled browser callback when empty');
  assert.ok(!calls.includes('never'));

  const running = new AbortController();
  const delayed = resolveDictionaryTextEntries('first late', resolver, running.signal);
  const runningRejected = assert.rejects(delayed, /abort/iu);
  await tick();
  running.abort();
  await runningRejected;
  const replacement = resolveDictionaryTextEntries('replacement', resolver);
  assert.equal(callbacks.size, 0, 'do not overlap an uncooperative in-flight provider');
  release();
  await setImmediate();
  await drain();
  await replacement;
  assert.ok(!calls.includes('late'), 'do not continue an aborted iterator');
  assert.equal(maximum, 1);

  const order = [];
  let lastVisible = false;
  const record = async (word) => {
    order.push(word);
    if (word === 'top') lastVisible = true;
    return undefined;
  };
  const back = resolveDictionaryTextTask('middle tail', record, undefined, () => 1);
  const top = resolveDictionaryTextTask('top next', record, undefined, () => 0);
  const last = resolveDictionaryTextTask('bottom end', record, undefined, () =>
    lastVisible ? -1 : 2,
  );
  await drain();
  await Promise.all([back, top, last]);
  assert.deepEqual(
    order,
    ['top', 'bottom', 'end', 'next', 'middle', 'tail'],
    're-evaluate viewport priorities between calls',
  );

  const failure = resolveDictionaryTextEntries('bad', async () => {
    throw new Error('resource failed');
  });
  const failureRejected = assert.rejects(failure, /resource failed/u);
  const recovery = resolveDictionaryTextEntries('good', resolver);
  await drain();
  await failureRejected;
  assert.ok((await recovery).has('good'), 'errors must not stall other readers');

  delete globalThis.requestIdleCallback;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 16) return originalTimeout(callback, delay, ...args);
    callbacks.set(++sequence, callback);
    return sequence;
  };
  globalThis.clearTimeout = (id) => {
    if (!callbacks.delete(id)) originalClearTimeout(id);
  };
  const fallback = resolveDictionaryTextEntries('fallback', resolver);
  assert.ok(!calls.includes('fallback'));
  await drain();
  assert.ok((await fallback).has('fallback'));
  const cancelledFallback = new AbortController();
  const fallbackRejected = assert.rejects(
    resolveDictionaryTextEntries('never', resolver, cancelledFallback.signal),
    /abort/iu,
  );
  cancelledFallback.abort();
  await fallbackRejected;
  assert.equal(callbacks.size, 0);
  process.stdout.write(
    'Idle queue: serial across readers, lazy start, queued/in-flight cancellation, viewport reprioritization, failure isolation and timer fallback passed.\n',
  );
} finally {
  globalThis.requestIdleCallback = originalIdle;
  globalThis.cancelIdleCallback = originalCancel;
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  await server.close();
}

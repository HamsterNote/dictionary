import assert from 'node:assert/strict';

const workerRequests = [];
const audioPlayers = [];
const revokedUrls = [];

class MockWorker {
  messageListener;

  addEventListener(type, listener) {
    if (type === 'message') this.messageListener = listener;
  }

  postMessage(request) {
    workerRequests.push({ request, worker: this });
  }

  terminate() {}
}

class MockAudio {
  listeners = new Map();
  paused = false;

  constructor(url) {
    this.url = url;
    audioPlayers.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  pause() {
    this.paused = true;
  }

  play() {
    return Promise.resolve();
  }

  finish() {
    this.listeners.get('ended')?.();
  }
}

globalThis.Worker = MockWorker;
globalThis.Audio = MockAudio;
URL.createObjectURL = (blob) => `blob:${blob.size}`;
URL.revokeObjectURL = (url) => revokedUrls.push(url);

const { createKokoroPronouncer } = await import('../dist/kokoro.js');

const respond = (index, size) => {
  const pending = workerRequests[index];
  assert.ok(pending, `缺少第 ${String(index + 1)} 个 Worker 请求`);
  pending.worker.messageListener?.({
    data: { audio: new Blob([new Uint8Array(size)]), id: pending.request.id, status: 'success' },
  });
};

const nextTurn = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const reset = () => {
  workerRequests.length = 0;
  audioPlayers.length = 0;
  revokedUrls.length = 0;
};

{
  const pronouncer = createKokoroPronouncer({ cacheSize: 0 });
  const firstPronunciation = pronouncer.pronounce('first');
  const secondPronunciation = pronouncer.pronounce('second');
  assert.equal(workerRequests.length, 2, '两个朗读请求都应进入 Worker');

  respond(0, 1);
  await firstPronunciation;
  assert.equal(audioPlayers.length, 0, '过期请求完成后不应创建播放器');

  respond(1, 2);
  await nextTurn();
  assert.equal(audioPlayers.length, 1, '最后一次请求应创建唯一播放器');
  assert.equal(audioPlayers[0]?.paused, false, '新播放器开始时不应被旧请求暂停');
  assert.deepEqual(revokedUrls, [], '新播放器开始时不应被旧请求回收 URL');

  audioPlayers[0]?.finish();
  await secondPronunciation;
  assert.equal(audioPlayers[0]?.paused, true, '播放结束后应释放自己的播放器');
  assert.deepEqual(revokedUrls, ['blob:2'], '播放结束后应回收自己的 URL');
  pronouncer.dispose();
}

reset();
{
  const pronouncer = createKokoroPronouncer({ cacheSize: 0 });
  const firstPronunciation = pronouncer.pronounce('first');
  respond(0, 3);
  await nextTurn();
  assert.equal(audioPlayers.length, 1, '第一个请求应开始播放');

  const secondPronunciation = pronouncer.pronounce('second');
  await firstPronunciation;
  assert.equal(audioPlayers[0]?.paused, true, '新请求应立即暂停旧播放器');
  assert.deepEqual(revokedUrls, ['blob:3'], '新请求应立即回收旧 URL');

  respond(1, 4);
  await nextTurn();
  assert.equal(audioPlayers.length, 2, '新请求应创建自己的播放器');
  assert.equal(audioPlayers[1]?.paused, false, '旧请求结算不应暂停新播放器');
  audioPlayers[1]?.finish();
  await secondPronunciation;
  pronouncer.dispose();
}

reset();
{
  const pronouncer = createKokoroPronouncer({ cacheSize: 0 });
  const firstPronunciation = pronouncer.pronounce('first');
  const secondPronunciation = pronouncer.pronounce('second');
  respond(1, 5);
  await nextTurn();
  assert.equal(audioPlayers.length, 1, '后发请求先响应时应开始播放');

  respond(0, 6);
  await firstPronunciation;
  assert.equal(audioPlayers.length, 1, '旧响应晚到时不应创建播放器');
  assert.equal(audioPlayers[0]?.paused, false, '旧响应晚到时不应暂停新播放器');
  audioPlayers[0]?.finish();
  await secondPronunciation;
  pronouncer.dispose();
}

reset();
{
  const pronouncer = createKokoroPronouncer({ cacheSize: 0 });
  const pendingPronunciation = pronouncer.pronounce('pending');
  pronouncer.dispose();
  await assert.rejects(pendingPronunciation, /已释放/u, '释放时应拒绝尚未完成的 Worker 请求');
  respond(0, 7);
  await nextTurn();
  assert.equal(audioPlayers.length, 0, '释放后的晚到响应不应创建播放器');
}

reset();
{
  const pronouncer = createKokoroPronouncer({ cacheSize: 0 });
  const activePronunciation = pronouncer.pronounce('active');
  respond(0, 8);
  await nextTurn();
  pronouncer.dispose();
  await activePronunciation;
  assert.equal(audioPlayers[0]?.paused, true, '释放时应暂停当前播放器');
  assert.deepEqual(revokedUrls, ['blob:8'], '释放时应回收当前 URL');
}

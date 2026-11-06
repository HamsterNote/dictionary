import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const { createPronunciationBrowserController } = await server.ssrLoadModule(
    '/src/pronunciation-audio/browser.ts',
  );
  const { PronunciationAudioBlobCache } = await server.ssrLoadModule(
    '/src/pronunciation-audio/cache.ts',
  );
  const { pronunciationAudioManifest } = await server.ssrLoadModule(
    '/src/pronunciation-audio/index.ts',
  );
  const contexts = Object.fromEntries(
    pronunciationAudioManifest.entries.map((entry) => [
      entry.word,
      { word: entry.word, language: 'en', phonetic: entry.phonetic },
    ]),
  );

  class FakeAudio {
    constructor(url, behavior = {}) {
      this.url = url;
      this.duration = 1;
      this.readyState = behavior.metadata === 'error' ? 0 : 1;
      this.currentTime = 0;
      this.events = new Map();
      this.behavior = behavior;
      this.pauseCount = 0;
    }

    addEventListener(type, listener) {
      const listeners = this.events.get(type) ?? new Set();
      listeners.add(listener);
      this.events.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.events.get(type)?.delete(listener);
    }

    emit(type) {
      for (const listener of [...(this.events.get(type) ?? [])]) listener();
    }

    play() {
      this.playCount = (this.playCount ?? 0) + 1;
      if (this.behavior.play === 'pending') return new Promise(() => {});
      if (this.behavior.play === 'reject') {
        return Promise.reject(new DOMException('gesture required', 'NotAllowedError'));
      }
      return Promise.resolve();
    }

    pause() {
      this.pauseCount += 1;
    }

    load() {
      if (this.behavior.metadata === 'error') this.emit('error');
    }
  }

  function responseFor(url, body = 'audio') {
    const mime = url.includes('.mp3') ? 'audio/mpeg' : 'application/ogg';
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Type': mime, 'Content-Length': String(body.length) },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }

  function fakeTimers() {
    let clock = 0;
    const timers = [];
    return {
      now: () => clock,
      setTimeout: (callback, delay = 0) => {
        const timer = { callback, delay, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        timer.cleared = true;
      },
      fire: (delay) => {
        const timer = timers.find((candidate) => !candidate.cleared && candidate.delay === delay);
        assert.ok(
          timer,
          `missing timer ${delay}; pending: ${timers.filter((item) => !item.cleared).map((item) => item.delay)}`,
        );
        timer.cleared = true;
        clock += timer.delay;
        timer.callback();
      },
    };
  }

  async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  function fixture(overrides = {}) {
    const audioElements = [];
    const revoked = [];
    let objectId = 0;
    const controller = createPronunciationBrowserController({
      manifest: pronunciationAudioManifest,
      canPlayType: (mime) => (mime === 'audio/mpeg' ? 'probably' : ''),
      fetch: async (url) => responseFor(url),
      createAudio: (url) => {
        const element = new FakeAudio(url, overrides.audioBehavior?.(audioElements.length) ?? {});
        audioElements.push(element);
        return element;
      },
      createObjectURL: () => `blob:test-${++objectId}`,
      revokeObjectURL: (url) => revoked.push(url),
      ...overrides,
    });
    return { controller, audioElements, revoked };
  }

  {
    const { controller, audioElements, revoked } = fixture();
    assert.equal(controller.resolve(contexts.hello).status, 'available');
    assert.deepEqual(controller.resolve({ word: 'read', language: 'en', phonetic: 'ri:d' }), {
      status: 'unavailable',
      reason: 'not-found',
    });
    const playing = controller.play(contexts.hello);
    await flush();
    assert.equal(controller.getState().status, 'playing', JSON.stringify(controller.getState()));
    assert.equal(audioElements.length, 1);
    audioElements[0].emit('ended');
    await playing;
    assert.equal(controller.getState().status, 'idle');
    assert.deepEqual(revoked, ['blob:test-1']);
  }

  {
    let online = true;
    let fetches = 0;
    const { controller, audioElements } = fixture({
      isOnline: () => online,
      fetch: async (url) => {
        fetches += 1;
        return responseFor(url);
      },
    });
    let playing = controller.play(contexts.cat);
    await flush();
    audioElements[0].emit('ended');
    await playing;
    online = false;
    playing = controller.play(contexts.cat);
    await flush();
    assert.equal(fetches, 1);
    assert.equal(controller.getState().status, 'playing');
    audioElements[1].emit('ended');
    await playing;

    const offline = fixture({ isOnline: () => false });
    await offline.controller.play(contexts.dog);
    assert.equal(offline.controller.getState().error, 'offline');
    assert.equal(offline.audioElements.length, 0);
  }

  {
    const unsupported = fixture({ canPlayType: () => '' });
    await unsupported.controller.play(contexts.hello);
    assert.equal(unsupported.controller.getState().error, 'unsupported-format');

    let attempts = 0;
    let fail = true;
    const retry = fixture({
      fetch: async (url) => {
        attempts += 1;
        if (fail) return new Response('limited', { status: 429 });
        return responseFor(url);
      },
    });
    await retry.controller.play(contexts.hello);
    assert.equal(retry.controller.getState().status, 'error');
    assert.equal(attempts, 1);
    await flush();
    assert.equal(attempts, 1);
    fail = false;
    const second = retry.controller.play(contexts.hello);
    await flush();
    retry.audioElements[0].emit('ended');
    await second;
    assert.equal(retry.controller.getState().status, 'idle');
  }

  {
    let first = true;
    const gesture = fixture({
      audioBehavior: () => (first ? ((first = false), { play: 'reject' }) : {}),
    });
    await gesture.controller.play(contexts.hello);
    assert.equal(gesture.controller.getState().error, 'gesture');
    const replay = gesture.controller.play(contexts.hello);
    await flush();
    assert.equal(gesture.controller.getState().status, 'playing');
    gesture.audioElements[1].emit('ended');
    await replay;
  }

  {
    let online = true;
    const requests = [];
    const fallback = fixture({
      canPlayType: () => 'probably',
      isOnline: () => online,
      audioBehavior: (index) => (index === 0 ? { metadata: 'error' } : {}),
      fetch: async (url) => {
        requests.push(url);
        return responseFor(url);
      },
    });
    const playing = fallback.controller.play(contexts.hello);
    await flush();
    assert.equal(fallback.controller.getState().status, 'playing');
    assert.equal(requests.length, 2);
    assert.ok(requests[0].includes('.ogg'));
    assert.ok(requests[1].includes('.mp3'));
    fallback.audioElements[1].emit('ended');
    await playing;

    online = false;
    const cachedReplay = fallback.controller.play(contexts.hello);
    await flush();
    assert.equal(fallback.controller.getState().status, 'playing');
    assert.equal(requests.length, 2);
    assert.equal(fallback.audioElements.length, 3);
    fallback.audioElements[2].emit('ended');
    await cachedReplay;
  }

  {
    let fail = true;
    let requests = 0;
    const retry = fixture({
      canPlayType: () => 'probably',
      audioBehavior: () => (fail ? { metadata: 'error' } : {}),
      fetch: async (url) => {
        requests += 1;
        return responseFor(url);
      },
    });
    await retry.controller.play(contexts.hello);
    assert.equal(retry.controller.getState().error, 'decode');
    assert.equal(requests, 2);
    fail = false;
    const replay = retry.controller.play(contexts.hello);
    await flush();
    assert.equal(retry.controller.getState().status, 'playing');
    assert.equal(requests, 3);
    retry.audioElements[2].emit('ended');
    await replay;
  }

  {
    const timers = fakeTimers();
    const pending = fixture({ ...timers, fetch: () => new Promise(() => {}) });
    const playing = pending.controller.play(contexts.hello);
    await flush();
    timers.fire(10_000);
    await playing;
    assert.equal(pending.controller.getState().error, 'timeout');
  }

  {
    const timers = fakeTimers();
    const startup = fixture({ ...timers, audioBehavior: () => ({ play: 'pending' }) });
    const playing = startup.controller.play(contexts.hello);
    await flush();
    timers.fire(5_000);
    await playing;
    assert.equal(startup.controller.getState().error, 'timeout');
  }

  {
    const timers = fakeTimers();
    const watchdog = fixture({ ...timers });
    const playing = watchdog.controller.play(contexts.hello);
    await flush();
    assert.equal(watchdog.controller.getState().status, 'playing');
    timers.fire(6_000);
    await playing;
    assert.equal(watchdog.controller.getState().error, 'timeout');
  }

  {
    let resolveSlow;
    const late = fixture({
      fetch: (url) =>
        url.includes('En-uk-hello')
          ? new Promise((resolve) => {
              resolveSlow = resolve;
            })
          : Promise.resolve(responseFor(url)),
    });
    const slow = late.controller.play(contexts.hello);
    await flush();
    const fast = late.controller.play(contexts.cat);
    await flush();
    assert.equal(late.controller.getState().contextKey.includes('cat'), true);
    assert.equal(late.audioElements.length, 1);
    resolveSlow(responseFor('https://upload.wikimedia.org/En-uk-hello.mp3'));
    await slow;
    await flush();
    assert.equal(late.audioElements.length, 1);
    late.audioElements[0].emit('ended');
    await fast;

    let resolveStopped;
    const stopped = fixture({
      fetch: () =>
        new Promise((resolve) => {
          resolveStopped = resolve;
        }),
    });
    const pending = stopped.controller.play(contexts.hello);
    stopped.controller.stop();
    resolveStopped(responseFor('https://upload.wikimedia.org/En-uk-hello.mp3'));
    await pending;
    await flush();
    assert.equal(stopped.audioElements.length, 0);
    assert.equal(stopped.controller.getState().status, 'idle');
  }

  {
    const { controller, audioElements, revoked } = fixture();
    const playing = controller.play(contexts.hello);
    await flush();
    controller.dispose();
    controller.dispose();
    await playing;
    assert.equal(audioElements[0].pauseCount >= 1, true);
    assert.deepEqual(revoked, ['blob:test-1']);
    await controller.play(contexts.hello);
    assert.equal(audioElements.length, 1);
  }

  {
    const cache = new PronunciationAudioBlobCache();
    for (let index = 0; index < 20; index += 1) {
      assert.equal(cache.set(`v1-${index}`, new Blob([String(index)])), true);
    }
    assert.equal(cache.size, 20);
    cache.get('v1-0');
    cache.set('v1-20', new Blob(['20']));
    assert.equal(cache.get('v1-1'), undefined);
    assert.equal(cache.get('v1-0') !== undefined, true);
    assert.equal(cache.get('v2-0'), undefined);

    const bytes = new PronunciationAudioBlobCache();
    for (let index = 0; index < 6; index += 1) {
      bytes.set(String(index), new Blob([new Uint8Array(2 * 1024 * 1024)]));
    }
    assert.equal(bytes.size, 5);
    assert.equal(bytes.totalBytes, 10 * 1024 * 1024);
    assert.equal(bytes.set('large', new Blob([new Uint8Array(2 * 1024 * 1024 + 1)])), false);
    bytes.clear();
    assert.equal(bytes.size, 0);
    assert.equal(bytes.totalBytes, 0);
  }

  console.log('test_pronunciation_audio_browser: OK');
} finally {
  await server.close();
}

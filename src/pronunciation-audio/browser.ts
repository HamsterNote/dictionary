import { PronunciationAudioBlobCache } from './cache';
import type {
  PronunciationAudioAsset,
  PronunciationAudioManifest,
  PronunciationAudioMedia,
  PronunciationContext,
} from './contracts';
import {
  type PronunciationPlaybackController,
  type PronunciationPlaybackError,
  type PronunciationPlaybackState,
  pronunciationContextKey,
} from './controller';
import { pronunciationAudioManifest } from './index';
import { resolvePronunciationAudio } from './resolve';

const PREPARE_TIMEOUT_MS = 10_000;
const PLAY_START_TIMEOUT_MS = 5_000;
const MAX_PLAYBACK_MS = 35_000;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30;

interface AudioEventTarget {
  readonly duration: number;
  readonly readyState: number;
  readonly currentTime: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  removeAttribute?(name: string): void;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  canPlayType(mime: string): string;
}

export interface PronunciationBrowserOptions {
  readonly manifest?: PronunciationAudioManifest;
  readonly fetch?: typeof fetch;
  readonly createAudio?: (url: string) => AudioEventTarget;
  readonly canPlayType?: (mime: string) => string;
  readonly createObjectURL?: (blob: Blob) => string;
  readonly revokeObjectURL?: (url: string) => void;
  readonly isOnline?: () => boolean;
  readonly now?: () => number;
  readonly setTimeout?: typeof globalThis.setTimeout;
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

class PlaybackCancelled extends Error {}
class PlaybackFailure extends Error {
  constructor(
    readonly kind: PronunciationPlaybackError,
    message: string,
  ) {
    super(message);
  }
}

function mimeMatches(actual: string, expected: string): boolean {
  const normalized = actual.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (normalized === expected) return true;
  return (
    new Set([normalized, expected]).size === 2 &&
    [normalized, expected].every((mime) => ['audio/ogg', 'application/ogg'].includes(mime))
  );
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotAllowedError';
}

export function createPronunciationBrowserController(
  options: PronunciationBrowserOptions = {},
): PronunciationPlaybackController {
  const manifest = options.manifest ?? pronunciationAudioManifest;
  const fetchImpl: typeof fetch | undefined = options.fetch ?? globalThis.fetch;
  const createAudio = options.createAudio ?? ((url: string) => new Audio(url));
  const canPlayType = options.canPlayType ?? ((mime: string) => new Audio().canPlayType(mime));
  const createObjectURL = options.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = options.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const navigatorRef = globalThis.navigator as Partial<Navigator> | undefined;
  const isOnline = options.isOnline ?? (() => navigatorRef?.onLine !== false);
  const now = options.now ?? Date.now;
  const setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const cache = new PronunciationAudioBlobCache();
  const listeners = new Set<(state: PronunciationPlaybackState) => void>();
  const cancellers = new Set<() => void>();
  let generation = 0;
  let disposed = false;
  let state: PronunciationPlaybackState = { status: 'idle' };
  let audio: AudioEventTarget | undefined;
  let objectUrl: string | undefined;
  let abort: AbortController | undefined;

  function publish(next: PronunciationPlaybackState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function releasePlayback(): void {
    abort?.abort();
    abort = undefined;
    for (const cancel of [...cancellers]) cancel();
    if (audio !== undefined) {
      audio.pause();
      // Loading the still-attached Blob starts another request just before its
      // URL is revoked. Detach first; custom adapters without DOM attributes
      // can release by pause/drop rather than accidentally reloading media.
      if (audio.removeAttribute) {
        audio.removeAttribute('src');
        audio.load();
      }
    }
    audio = undefined;
    if (objectUrl !== undefined) revokeObjectURL(objectUrl);
    objectUrl = undefined;
  }

  function stop(): void {
    generation += 1;
    releasePlayback();
    if (!disposed) publish({ status: 'idle' });
  }

  function withTimeout<T>(
    promise: Promise<T>,
    milliseconds: number,
    requestGeneration: number,
    kind: PronunciationPlaybackError = 'timeout',
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        cancellers.delete(cancel);
        action();
      };
      const timer = setTimer(
        () => {
          finish(() => {
            reject(new PlaybackFailure(kind, `操作超过 ${String(milliseconds)} ms`));
          });
        },
        Math.max(0, milliseconds),
      );
      const cancel = (): void => {
        finish(() => {
          reject(new PlaybackCancelled());
        });
      };
      cancellers.add(cancel);
      promise.then(
        (value) => {
          finish(() => {
            resolve(value);
          });
        },
        (error: unknown) => {
          finish(() => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        },
      );
      if (requestGeneration !== generation) cancel();
    });
  }

  function assertCurrent(requestGeneration: number): void {
    if (disposed || requestGeneration !== generation) throw new PlaybackCancelled();
  }

  function cacheKey(asset: PronunciationAudioAsset, media: PronunciationAudioMedia): string {
    return `${manifest.manifestVersion}\n${asset.assetId}\n${asset.digest}\n${media.url}`;
  }

  function supportedMedia(asset: PronunciationAudioAsset): PronunciationAudioMedia[] {
    return asset.media.filter((media) => canPlayType(media.mime) !== '');
  }

  async function fetchBlob(
    media: PronunciationAudioMedia,
    requestGeneration: number,
  ): Promise<Blob> {
    if (fetchImpl === undefined) throw new PlaybackFailure('network', 'fetch 不可用');
    const controller = new AbortController();
    abort = controller;
    const response = await fetchImpl(media.url, { signal: controller.signal });
    assertCurrent(requestGeneration);
    const responseUrl = new URL(response.url || media.url);
    if (responseUrl.protocol !== 'https:' || responseUrl.hostname !== 'upload.wikimedia.org') {
      throw new PlaybackFailure('resource', '重定向 host 未获批准');
    }
    if (!response.ok) throw new PlaybackFailure('network', `HTTP ${String(response.status)}`);
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!mimeMatches(contentType, media.mime)) {
      throw new PlaybackFailure('resource', '响应 MIME 与已核验媒体不一致');
    }
    const contentLength = Number(response.headers.get('Content-Length') ?? 0);
    if (contentLength > MAX_MEDIA_BYTES) {
      throw new PlaybackFailure('resource', '录音超过 2 MiB');
    }
    const rawBlob = await response.blob();
    assertCurrent(requestGeneration);
    if (rawBlob.size <= 0 || rawBlob.size > MAX_MEDIA_BYTES) {
      throw new PlaybackFailure('resource', '录音为空或超过 2 MiB');
    }
    if (rawBlob.type && !mimeMatches(rawBlob.type, media.mime)) {
      throw new PlaybackFailure('resource', 'Blob MIME 不一致');
    }
    return rawBlob.type ? rawBlob : new Blob([rawBlob], { type: media.mime });
  }

  async function prepareCandidate(
    blob: Blob,
    requestGeneration: number,
    deadline: number,
  ): Promise<AudioEventTarget> {
    assertCurrent(requestGeneration);
    const url = createObjectURL(blob);
    objectUrl = url;
    const element = createAudio(url);
    audio = element;
    let metadataCleanup: (() => void) | undefined;
    const metadata = new Promise<void>((resolve, reject) => {
      const onMetadata = (): void => {
        resolve();
      };
      const onError = (): void => {
        reject(new PlaybackFailure('decode', '音频解码失败'));
      };
      element.addEventListener('loadedmetadata', onMetadata);
      element.addEventListener('error', onError);
      metadataCleanup = () => {
        element.removeEventListener('loadedmetadata', onMetadata);
        element.removeEventListener('error', onError);
      };
      cancellers.add(() => {
        metadataCleanup?.();
        reject(new PlaybackCancelled());
      });
      if (element.readyState >= 1) resolve();
      else element.load();
    });
    try {
      await withTimeout(metadata, deadline - now(), requestGeneration);
      assertCurrent(requestGeneration);
      if (
        !Number.isFinite(element.duration) ||
        element.duration <= 0 ||
        element.duration > MAX_DURATION_SECONDS
      ) {
        throw new PlaybackFailure('resource', '录音时长超过限制');
      }
      return element;
    } finally {
      metadataCleanup?.();
    }
  }

  async function play(context: PronunciationContext): Promise<void> {
    if (disposed) return;
    const requestGeneration = ++generation;
    releasePlayback();
    const contextKey = pronunciationContextKey(context);
    const resolution = resolvePronunciationAudio(manifest, context);
    if (resolution.status === 'unavailable') {
      publish({ status: 'unavailable', contextKey });
      return;
    }
    publish({ status: 'loading', contextKey });
    const supported = supportedMedia(resolution.asset);
    if (supported.length === 0) {
      publish({ status: 'error', contextKey, error: 'unsupported-format' });
      return;
    }
    const candidates = supported
      .map((media) => ({
        media,
        key: cacheKey(resolution.asset, media),
        cached: cache.get(cacheKey(resolution.asset, media)),
      }))
      .sort(
        (left, right) => Number(right.cached !== undefined) - Number(left.cached !== undefined),
      );
    const hasCached = candidates.some((candidate) => candidate.cached !== undefined);
    const deadline = now() + PREPARE_TIMEOUT_MS;
    try {
      if (!hasCached && !isOnline()) throw new PlaybackFailure('offline', '离线且无缓存');
      let element: AudioEventTarget | undefined;
      let lastError: unknown;
      for (const candidate of candidates) {
        const { media, key } = candidate;
        assertCurrent(requestGeneration);
        try {
          const blob =
            candidate.cached ??
            (await withTimeout(
              fetchBlob(media, requestGeneration),
              deadline - now(),
              requestGeneration,
            ));
          element = await prepareCandidate(blob, requestGeneration, deadline);
          cache.set(key, blob);
          try {
            await withTimeout(element.play(), PLAY_START_TIMEOUT_MS, requestGeneration, 'timeout');
          } catch (error) {
            if (
              error instanceof PlaybackCancelled ||
              error instanceof PlaybackFailure ||
              isNotAllowed(error)
            ) {
              throw error;
            }
            throw new PlaybackFailure('decode', '启动时无法解码音频');
          }
          break;
        } catch (error) {
          if (error instanceof PlaybackCancelled || isNotAllowed(error)) throw error;
          if (error instanceof PlaybackFailure && error.kind === 'timeout') throw error;
          element = undefined;
          cache.delete(key);
          lastError = error;
          releasePlayback();
        }
      }
      if (element === undefined) {
        throw lastError instanceof Error
          ? lastError
          : new PlaybackFailure('decode', '没有可解码媒体');
      }
      assertCurrent(requestGeneration);
      publish({ status: 'playing', contextKey });
      const ended = new Promise<void>((resolve, reject) => {
        const onEnded = (): void => {
          resolve();
        };
        const onError = (): void => {
          reject(new PlaybackFailure('playback', '播放失败'));
        };
        element.addEventListener('ended', onEnded);
        element.addEventListener('error', onError);
        const cleanup = (): void => {
          element.removeEventListener('ended', onEnded);
          element.removeEventListener('error', onError);
          cancellers.delete(cancel);
        };
        const cancel = (): void => {
          cleanup();
          reject(new PlaybackCancelled());
        };
        cancellers.add(cancel);
      });
      const watchdog = Math.min(MAX_PLAYBACK_MS, (element.duration + 5) * 1000);
      await withTimeout(ended, watchdog, requestGeneration, 'timeout');
      assertCurrent(requestGeneration);
      releasePlayback();
      publish({ status: 'idle', contextKey });
    } catch (error) {
      if (error instanceof PlaybackCancelled || requestGeneration !== generation) return;
      const kind =
        error instanceof PlaybackFailure ? error.kind : isNotAllowed(error) ? 'gesture' : 'network';
      releasePlayback();
      publish({ status: 'error', contextKey, error: kind });
    } finally {
      if (requestGeneration === generation) abort = undefined;
    }
  }

  return {
    resolve: (context) => resolvePronunciationAudio(manifest, context),
    play,
    stop,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      releasePlayback();
      cache.clear();
      listeners.clear();
    },
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface KokoroPronouncer {
  readonly dispose: () => void;
  readonly pronounce: (word: string) => Promise<void>;
}

export interface KokoroPronouncerProps {
  /** 最多缓存的读音数量；设为 0 可关闭缓存。 */
  readonly cacheSize?: number;
}

interface KokoroWorkerRequest {
  readonly id: number;
  readonly text: string;
}

type KokoroWorkerResponse =
  | { readonly audio: Blob; readonly id: number; readonly status: 'success' }
  | { readonly id: number; readonly message: string; readonly status: 'error' };

interface PendingRequest {
  readonly reject: (reason: Error) => void;
  readonly resolve: (audio: Blob) => void;
}

class KokoroPronunciationError extends Error {
  override readonly name = 'KokoroPronunciationError';
}

const DEFAULT_CACHE_SIZE = 10;

export function createKokoroPronouncer({
  cacheSize = DEFAULT_CACHE_SIZE,
}: KokoroPronouncerProps = {}): KokoroPronouncer {
  const audioCache = new Map<string, Blob>();
  const normalizedCacheSize = Math.max(0, Math.floor(cacheSize));
  const pendingRequests = new Map<number, PendingRequest>();
  let activeAudio: HTMLAudioElement | undefined;
  let activePlaybackAbort: AbortController | undefined;
  let activeUrl: string | undefined;
  let nextRequestId = 0;
  let pronunciationGeneration = 0;
  let worker: Worker | undefined;

  const disposeAudio = () => {
    activePlaybackAbort?.abort();
    activePlaybackAbort = undefined;
    activeAudio?.pause();
    activeAudio = undefined;
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    activeUrl = undefined;
  };

  const getWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL('./kokoro.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<KokoroWorkerResponse>) => {
      const response = event.data;
      const pendingRequest = pendingRequests.get(response.id);
      if (!pendingRequest) return;
      pendingRequests.delete(response.id);
      switch (response.status) {
        case 'success':
          pendingRequest.resolve(response.audio);
          break;
        case 'error':
          pendingRequest.reject(new KokoroPronunciationError(response.message));
          break;
      }
    });
    worker.addEventListener('error', () => {
      const error = new KokoroPronunciationError('Kokoro Worker 运行失败');
      for (const pendingRequest of pendingRequests.values()) pendingRequest.reject(error);
      pendingRequests.clear();
      worker?.terminate();
      worker = undefined;
    });
    return worker;
  };

  const getAudio = async (word: string): Promise<Blob> => {
    const cachedAudio = audioCache.get(word);
    if (cachedAudio) {
      // Map 保持插入顺序；重新插入后，最久未使用的读音始终位于首项。
      audioCache.delete(word);
      audioCache.set(word, cachedAudio);
      return cachedAudio;
    }

    const id = nextRequestId;
    nextRequestId += 1;
    const audioBlob = await new Promise<Blob>((resolve, reject) => {
      pendingRequests.set(id, { reject, resolve });
      const request = { id, text: word } satisfies KokoroWorkerRequest;
      getWorker().postMessage(request);
    });

    if (normalizedCacheSize > 0) {
      audioCache.set(word, audioBlob);
      if (audioCache.size > normalizedCacheSize) {
        const oldestWord = audioCache.keys().next().value;
        if (oldestWord !== undefined) audioCache.delete(oldestWord);
      }
    }
    return audioBlob;
  };

  return {
    dispose: () => {
      pronunciationGeneration += 1;
      disposeAudio();
      audioCache.clear();
      worker?.terminate();
      worker = undefined;
      const error = new KokoroPronunciationError('Kokoro 朗读器已释放');
      for (const pendingRequest of pendingRequests.values()) pendingRequest.reject(error);
      pendingRequests.clear();
    },
    pronounce: async (word) => {
      pronunciationGeneration += 1;
      const generation = pronunciationGeneration;
      disposeAudio();
      const audioBlob = await getAudio(word);
      if (generation !== pronunciationGeneration) return;

      activeUrl = URL.createObjectURL(audioBlob);
      activeAudio = new Audio(activeUrl);
      const playbackAbort = new AbortController();
      activePlaybackAbort = playbackAbort;
      await new Promise<void>((resolve, reject) => {
        const audio = activeAudio;
        if (!audio) {
          reject(new KokoroPronunciationError('音频播放器初始化失败'));
          return;
        }
        audio.addEventListener(
          'ended',
          () => {
            resolve();
          },
          { once: true },
        );
        audio.addEventListener(
          'error',
          () => {
            reject(new KokoroPronunciationError('浏览器无法播放生成的语音'));
          },
          { once: true },
        );
        playbackAbort.signal.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
        void audio.play().catch((error: unknown) => {
          reject(
            error instanceof Error
              ? error
              : new KokoroPronunciationError('浏览器拒绝播放生成的语音'),
          );
        });
      }).finally(() => {
        if (generation === pronunciationGeneration) disposeAudio();
      });
    },
  };
}

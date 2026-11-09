import ResourceWorker from './resourceDecoder.worker?worker&inline';
import { decodeResource } from './decodeResource';
import type { OfflineDictionaryResource } from './types';

interface PendingDecode {
  readonly resolve: (raw: Uint8Array | string) => void;
  readonly reject: (error: Error) => void;
  readonly zipped: Uint8Array;
  readonly resource: OfflineDictionaryResource;
  readonly text: boolean;
}

// One worker per store. Resource validation remains identical in workers and
// the fallback used by SSR and hosts that disallow blob workers.
export class OfflineResourceDecoder {
  #worker: Worker | undefined;
  #unavailable = false;
  #disposed = false;
  #sequence = 0;
  readonly #pending = new Map<number, PendingDecode>();

  decode(zipped: Uint8Array, resource: OfflineDictionaryResource): Promise<Uint8Array> {
    return this.#request(zipped, resource, false);
  }

  decodeText(zipped: Uint8Array, resource: OfflineDictionaryResource): Promise<string> {
    return this.#request(zipped, resource, true);
  }

  #decodeSync(
    zipped: Uint8Array,
    resource: OfflineDictionaryResource,
    text: boolean,
  ): Uint8Array | string {
    if (this.#disposed) throw new Error('词典资源实例已释放');
    const raw = decodeResource(zipped, resource);
    return text ? new TextDecoder().decode(raw) : raw;
  }

  #request(
    zipped: Uint8Array,
    resource: OfflineDictionaryResource,
    text: false,
  ): Promise<Uint8Array>;
  #request(zipped: Uint8Array, resource: OfflineDictionaryResource, text: true): Promise<string>;
  #request(
    zipped: Uint8Array,
    resource: OfflineDictionaryResource,
    text: boolean,
  ): Promise<Uint8Array | string> {
    if (this.#disposed) return Promise.reject(new Error('词典资源实例已释放'));
    if (!this.#worker && !this.#unavailable) {
      try {
        if (typeof Worker === 'undefined') this.#unavailable = true;
        else {
          this.#worker = new ResourceWorker();
          this.#worker.onmessage = ({
            data,
          }: MessageEvent<{ id: number; raw?: Uint8Array; text?: string; error?: string }>) => {
            const pending = this.#pending.get(data.id);
            if (!pending) return;
            this.#pending.delete(data.id);
            if (data.error) pending.reject(new Error(data.error));
            else if (data.text !== undefined) pending.resolve(data.text);
            else if (data.raw) pending.resolve(data.raw);
            else pending.reject(new Error('词典资源解码结果无效'));
          };
          this.#worker.onerror = (event) => {
            event.preventDefault();
            this.#fallback();
          };
          this.#worker.onmessageerror = () => {
            this.#fallback();
          };
        }
      } catch {
        this.#fallback();
      }
    }
    if (!this.#worker)
      return Promise.resolve().then(() => {
        return this.#decodeSync(zipped, resource, text);
      });
    const worker = this.#worker;
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, zipped, resource, text });
      try {
        // Readers may reuse their buffers. Transfer a copy, never detach theirs.
        const owned = new Uint8Array(zipped);
        worker.postMessage({ id, resource, zipped: owned, text }, [owned.buffer]);
      } catch {
        this.#fallback();
      }
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const pending of this.#pending.values()) pending.reject(new Error('词典资源实例已释放'));
    this.#pending.clear();
  }

  #fallback(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#unavailable = true;
    for (const pending of this.#pending.values()) {
      void Promise.resolve()
        .then(() => {
          return this.#decodeSync(pending.zipped, pending.resource, pending.text);
        })
        .then(pending.resolve, pending.reject);
    }
    this.#pending.clear();
  }
}

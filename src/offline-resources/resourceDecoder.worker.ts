import { decodeResource } from './decodeResource';
import type { OfflineDictionaryResource } from './types';

interface DecodeRequest {
  readonly id: number;
  readonly resource: OfflineDictionaryResource;
  readonly zipped: Uint8Array;
  readonly text: boolean;
}
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<DecodeRequest>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = ({ data }) => {
  try {
    const raw = decodeResource(data.zipped, data.resource);
    if (data.text) scope.postMessage({ id: data.id, text: new TextDecoder().decode(raw) });
    else scope.postMessage({ id: data.id, raw }, [raw.buffer as ArrayBuffer]);
  } catch (error: unknown) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : '词典资源解码失败',
    });
  }
};

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { gunzipSync } from 'fflate';
import type { OfflineDictionaryResource } from './types';

export function decodeResource(
  zipped: Uint8Array,
  resource: OfflineDictionaryResource,
): Uint8Array {
  if (zipped.byteLength !== resource.bytes) throw new Error(`${resource.id} 的压缩长度校验失败`);
  if (bytesToHex(sha256(zipped)) !== resource.sha256)
    throw new Error(`${resource.id} 的压缩 SHA-256 校验失败`);
  const raw = gunzipSync(zipped);
  if (raw.byteLength !== resource.uncompressedBytes)
    throw new Error(`${resource.id} 的解压长度校验失败`);
  if (bytesToHex(sha256(raw)) !== resource.uncompressedSha256)
    throw new Error(`${resource.id} 的解压 SHA-256 校验失败`);
  return raw;
}

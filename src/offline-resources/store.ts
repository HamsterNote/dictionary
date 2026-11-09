import { OfflineResourceDecoder } from './resourceDecoder';
import { createChineseDictionaryPack, type ChineseDictionaryPack } from '../chineseDictionaryPack';
import type { DictionaryEntrySummary } from '../dictionaryEntrySummary';
import { createEnglishRootPack, type EnglishRootPack } from '../englishRootPack';
import { createEnglishSynonymPack, type EnglishSynonymPack } from '../englishSynonymPack';
import {
  lookupChinese,
  normalizeChineseQuery,
  resolveChineseEntry,
  type ChineseLookupResult,
} from '../lookupChinese';
import { normalizeEnglishChineseQuery } from '../lookupEnglishChinese';
import type {
  OfflineDictionaryManifest,
  OfflineDictionaryPack,
  OfflineDictionaryResource,
  OfflineDictionaryResourceReader,
  OfflineDictionaryResourceStoreOptions,
  OfflineDictionaryResourceStoreStats,
  OfflineDictionaryShard,
} from './types';

const MAX_SHARD_CACHE_BYTES = 12 * 1024 * 1024;
const textDecoder = new TextDecoder();

interface IndexReference {
  readonly rowNumber: number;
  readonly shardNumber: number;
  readonly word: string;
}

interface RankedSuggestion {
  readonly originalOrder: number;
  readonly word: string;
}

function lineAt(index: string, lineStart: number): { readonly end: number; readonly word: string } {
  const firstTab = index.indexOf('\t', lineStart);
  const end = index.indexOf('\n', firstTab);
  return {
    end: end < 0 ? index.length : end,
    word: index.slice(lineStart, firstTab < 0 ? end : firstTab),
  };
}

function lowerBound(index: string, query: string): number {
  let low = 0;
  let high = index.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const lineStart = middle === 0 ? 0 : index.lastIndexOf('\n', middle - 1) + 1;
    if (lineStart >= high) {
      high = middle;
      continue;
    }
    const line = lineAt(index, lineStart);
    if (line.word < query) low = line.end + 1;
    else high = lineStart;
  }
  return low === 0 ? 0 : index.lastIndexOf('\n', low - 1) + 1;
}

function parseReference(index: string, lineStart: number): IndexReference | undefined {
  const lineEnd = index.indexOf('\n', lineStart);
  const end = lineEnd < 0 ? index.length : lineEnd;
  const fields = index.slice(lineStart, end).split('\t');
  const word = fields[0];
  const shardNumber = Number(fields[1]);
  const rowNumber = Number(fields[2]);
  if (!word || !Number.isInteger(shardNumber) || !Number.isInteger(rowNumber)) return undefined;
  return { rowNumber, shardNumber, word };
}

function findReferences(index: string, query: string, prefix: boolean): IndexReference[] {
  const references: IndexReference[] = [];
  let lineStart = lowerBound(index, query);
  while (lineStart < index.length) {
    const reference = parseReference(index, lineStart);
    if (reference === undefined) throw new Error('词典索引记录无效');
    if (prefix ? !reference.word.startsWith(query) : reference.word !== query) break;
    references.push(reference);
    const lineEnd = index.indexOf('\n', lineStart);
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }
  return references;
}

function metadataFor(pack: OfflineDictionaryPack) {
  return {
    entryCount: pack.entryCount,
    gzipBytes: pack.shards.reduce((total, shard) => total + shard.bytes, 0),
    id: pack.legacyId,
    label: pack.label,
  };
}

export class OfflineDictionaryResourceStore {
  readonly #manifest: OfflineDictionaryManifest;
  readonly #reader: OfflineDictionaryResourceReader;
  readonly #packs: ReadonlyMap<string, OfflineDictionaryPack>;
  readonly #indexes = new Map<string, Promise<string>>();
  readonly #shards = new Map<string, Uint8Array>();
  readonly #pendingShards = new Map<string, Promise<Uint8Array>>();
  #rowsByShard = new WeakMap<Uint8Array, readonly string[]>();
  readonly #maxShardCacheBytes: number;
  #shardCacheBytes = 0;
  #disposed = false;
  readonly #decoder = new OfflineResourceDecoder();

  constructor(
    manifest: OfflineDictionaryManifest,
    reader: OfflineDictionaryResourceReader,
    options: OfflineDictionaryResourceStoreOptions = {},
  ) {
    if (manifest.formatVersion !== 1) throw new Error('不支持的词典资源格式');
    this.#manifest = manifest;
    this.#reader = reader;
    this.#packs = new Map(manifest.packs.map((pack) => [pack.id, pack]));
    this.#maxShardCacheBytes = Math.min(
      options.maxShardCacheBytes ?? MAX_SHARD_CACHE_BYTES,
      MAX_SHARD_CACHE_BYTES,
    );
  }

  get manifest(): OfflineDictionaryManifest {
    return this.#manifest;
  }

  get stats(): OfflineDictionaryResourceStoreStats {
    return {
      cachedShardBytes: this.#shardCacheBytes,
      cachedShards: this.#shards.size,
      loadedIndexes: this.#indexes.size,
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#decoder.dispose();
    this.#indexes.clear();
    this.#shards.clear();
    this.#pendingShards.clear();
    this.#shardCacheBytes = 0;
    this.#rowsByShard = new WeakMap();
  }

  async lookupChinese(query: string): Promise<ChineseLookupResult> {
    const normalizedQuery = normalizeChineseQuery(query);
    if (!normalizedQuery) return { query: query.trim(), status: 'not-found' };
    const packs = await this.#materializeExactPacks('chinese', normalizedQuery, false);
    return lookupChinese(query, packs);
  }

  async suggestChineseEntries(
    query: string,
    limit = 18,
  ): Promise<readonly DictionaryEntrySummary[]> {
    const normalizedQuery = normalizeChineseQuery(query);
    if (!normalizedQuery || limit <= 0) return [];
    const ranked: RankedSuggestion[] = [];
    const seen = new Set<string>();
    let originalOrder = 0;
    for (const pack of this.#packsByKind('chinese')) {
      const index = await this.#readIndex(pack);
      const references = findReferences(index, normalizedQuery, true).sort(
        (left, right) => left.rowNumber - right.rowNumber,
      );
      for (const reference of references) {
        if (seen.has(reference.word)) continue;
        seen.add(reference.word);
        ranked.push({ originalOrder: originalOrder++, word: reference.word });
      }
    }
    ranked.sort((left, right) => {
      if (left.word === normalizedQuery) return -1;
      if (right.word === normalizedQuery) return 1;
      return left.word.length - right.word.length || left.originalOrder - right.originalOrder;
    });
    const selected = ranked.slice(0, limit);
    const packs = await Promise.all(
      selected.map(async ({ word }) => {
        const matchingPacks = await this.#materializeExactPacks('chinese', word, false);
        return resolveChineseEntry(word, matchingPacks);
      }),
    );
    return packs.flatMap((entry) => (entry === undefined ? [] : [entry]));
  }

  async getSynonymPacks(query: string): Promise<readonly EnglishSynonymPack[]> {
    const normalizedQuery = normalizeEnglishChineseQuery(query);
    if (!normalizedQuery) return [];
    return (await this.#materializeExactPacks('synonyms', normalizedQuery, false)).map(
      (pack): EnglishSynonymPack => ({
        entries: pack.entries,
        entryCount: pack.entryCount,
        gzipBytes: pack.gzipBytes,
        id: pack.id,
        label: pack.label,
      }),
    );
  }

  async getRootPacks(query: string): Promise<readonly EnglishRootPack[]> {
    const normalizedQuery = normalizeEnglishChineseQuery(query);
    if (!normalizedQuery) return [];
    return (await this.#materializeExactPacks('roots', normalizedQuery, false)).map(
      (pack): EnglishRootPack => ({
        entries: pack.entries,
        entryCount: pack.entryCount,
        gzipBytes: pack.gzipBytes,
        id: pack.id,
        label: pack.label,
      }),
    );
  }

  async readPackShard(packId: string, shardNumber: number): Promise<Uint8Array> {
    const pack = this.#packs.get(packId);
    const shard = pack?.shards[shardNumber];
    if (!pack || !shard) throw new Error('词典资源标识不在 manifest 允许范围内');
    return this.#readShard(pack, shard);
  }

  clearShardCache(): void {
    this.#shards.clear();
    this.#shardCacheBytes = 0;
    this.#rowsByShard = new WeakMap();
  }

  #packsByKind(kind: OfflineDictionaryPack['kind']): readonly OfflineDictionaryPack[] {
    return this.#manifest.packs.filter((pack) => pack.kind === kind);
  }

  async #materializeExactPacks(
    kind: 'chinese',
    query: string,
    prefix: boolean,
  ): Promise<readonly ChineseDictionaryPack[]>;
  async #materializeExactPacks(
    kind: 'roots',
    query: string,
    prefix: boolean,
  ): Promise<readonly EnglishRootPack[]>;
  async #materializeExactPacks(
    kind: 'synonyms',
    query: string,
    prefix: boolean,
  ): Promise<readonly EnglishSynonymPack[]>;
  async #materializeExactPacks(
    kind: OfflineDictionaryPack['kind'],
    query: string,
    prefix: boolean,
  ): Promise<readonly (ChineseDictionaryPack | EnglishRootPack | EnglishSynonymPack)[]> {
    const packs = [];
    for (const pack of this.#packsByKind(kind)) {
      const index = await this.#readIndex(pack);
      const references = findReferences(index, query, prefix);
      if (references.length === 0) continue;
      const rows = await this.#readRows(pack, references);
      const snapshot = `${pack.header}\n${rows.join('')}`;
      if (kind === 'chinese') packs.push(createChineseDictionaryPack(snapshot, metadataFor(pack)));
      else if (kind === 'roots') packs.push(createEnglishRootPack(snapshot, metadataFor(pack)));
      else packs.push(createEnglishSynonymPack(snapshot, metadataFor(pack)));
    }
    return packs;
  }

  async #readRows(
    pack: OfflineDictionaryPack,
    references: readonly IndexReference[],
  ): Promise<readonly string[]> {
    const rowsByReference = new Map<number, string>();
    const referencesByShard = new Map<number, IndexReference[]>();
    for (const reference of references) {
      const group = referencesByShard.get(reference.shardNumber) ?? [];
      group.push(reference);
      referencesByShard.set(reference.shardNumber, group);
    }
    for (const [shardNumber, shardReferences] of referencesByShard) {
      const shard = pack.shards[shardNumber];
      if (!shard) throw new Error(`${pack.id} 的索引指向不存在的分片`);
      const contents = await this.#readShard(pack, shard);
      let rows = this.#rowsByShard.get(contents);
      if (!rows) {
        rows = textDecoder.decode(contents).split('\n');
        this.#rowsByShard.set(contents, rows);
      }
      for (const reference of shardReferences) {
        const row = rows[reference.rowNumber - shard.firstRow];
        if (row?.split('\t', 1)[0] !== reference.word) {
          throw new Error(`${pack.id} 的分片与索引行序不一致`);
        }
        rowsByReference.set(reference.rowNumber, `${row}\n`);
      }
    }
    return references.map((reference) => {
      const row = rowsByReference.get(reference.rowNumber);
      if (row === undefined) throw new Error(`${pack.id} 缺少索引对应行`);
      return row;
    });
  }

  #readIndex(pack: OfflineDictionaryPack): Promise<string> {
    this.#assertActive();
    const cached = this.#indexes.get(pack.id);
    if (cached) return cached;
    const pending = this.#readIndexText(pack.index).catch((error: unknown) => {
      this.#indexes.delete(pack.id);
      throw error;
    });
    this.#indexes.set(pack.id, pending);
    return pending;
  }

  #readShard(_pack: OfflineDictionaryPack, shard: OfflineDictionaryShard): Promise<Uint8Array> {
    this.#assertActive();
    const cached = this.#shards.get(shard.id);
    if (cached) {
      this.#shards.delete(shard.id);
      this.#shards.set(shard.id, cached);
      return Promise.resolve(cached);
    }
    const pending = this.#pendingShards.get(shard.id);
    if (pending) return pending;
    const request = this.#readCompressedResource(shard)
      .then((raw) => {
        this.#cacheShard(shard, raw);
        return raw;
      })
      .finally(() => {
        this.#pendingShards.delete(shard.id);
      });
    this.#pendingShards.set(shard.id, request);
    return request;
  }

  async #readCompressedResource(resource: OfflineDictionaryResource): Promise<Uint8Array> {
    this.#assertActive();
    const zipped = await this.#reader.read(resource);
    this.#assertActive();
    const raw = await this.#decoder.decode(zipped, resource);
    this.#assertActive();
    return raw;
  }

  async #readIndexText(resource: OfflineDictionaryResource): Promise<string> {
    this.#assertActive();
    const zipped = await this.#reader.read(resource);
    this.#assertActive();
    const text = await this.#decoder.decodeText(zipped, resource);
    this.#assertActive();
    return text;
  }

  #cacheShard(shard: OfflineDictionaryShard, raw: Uint8Array): void {
    if (raw.byteLength > this.#maxShardCacheBytes) return;
    while (
      this.#shards.size > 0 &&
      this.#shardCacheBytes + raw.byteLength > this.#maxShardCacheBytes
    ) {
      const oldestKey = this.#shards.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.#shards.get(oldestKey);
      this.#shards.delete(oldestKey);
      this.#shardCacheBytes -= oldest?.byteLength ?? 0;
    }
    this.#shards.set(shard.id, raw);
    this.#shardCacheBytes += raw.byteLength;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('词典资源实例已释放');
  }
}

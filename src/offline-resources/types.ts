import type { DictionaryEntrySummary } from '../dictionaryEntrySummary';
import type { EnglishRootPack } from '../englishRootPack';
import type { EnglishSynonymPack } from '../englishSynonymPack';
import type { ChineseLookupResult } from '../lookupChinese';

export interface OfflineDictionaryResource {
  readonly id: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly uncompressedBytes: number;
  readonly uncompressedSha256: string;
}

export interface OfflineDictionaryShard extends OfflineDictionaryResource {
  readonly firstRow: number;
  readonly lastRow: number;
}

export interface OfflineDictionaryPack {
  readonly id: string;
  readonly legacyId: string;
  readonly kind: 'chinese' | 'roots' | 'synonyms';
  readonly label: string;
  readonly source: Readonly<Record<string, string>>;
  readonly header: string;
  readonly rowOrder: 'source';
  readonly recordCount: number;
  readonly entryCount: number;
  readonly uncompressedBytes: number;
  readonly uncompressedSha256: string;
  readonly index: OfflineDictionaryResource & { readonly recordCount: number };
  readonly shards: readonly OfflineDictionaryShard[];
}

export interface OfflineDictionaryManifest {
  readonly formatVersion: number;
  readonly packageVersion: string;
  readonly shardTargetBytes: number;
  readonly packs: readonly OfflineDictionaryPack[];
}

export interface OfflineDictionaryResourceReader {
  readonly read: (resource: OfflineDictionaryResource) => Promise<Uint8Array>;
}

export interface OfflineDictionaryResourceStoreOptions {
  readonly maxShardCacheBytes?: number;
}

export interface OfflineDictionaryResourceStoreStats {
  readonly cachedShardBytes: number;
  readonly cachedShards: number;
  readonly loadedIndexes: number;
}

export interface OfflineDictionaryResourceStore {
  readonly manifest: OfflineDictionaryManifest;
  readonly stats: OfflineDictionaryResourceStoreStats;
  readonly lookupChinese: (query: string) => Promise<ChineseLookupResult>;
  readonly suggestChineseEntries: (
    query: string,
    limit?: number,
  ) => Promise<readonly DictionaryEntrySummary[]>;
  readonly getSynonymPacks: (query: string) => Promise<readonly EnglishSynonymPack[]>;
  readonly getRootPacks: (query: string) => Promise<readonly EnglishRootPack[]>;
  readonly readPackShard: (packId: string, shardNumber: number) => Promise<Uint8Array>;
  readonly clearShardCache: () => void;
  readonly dispose: () => void;
}

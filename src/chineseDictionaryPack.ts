export type ChineseDictionaryEntry = readonly [
  pinyin: string,
  category: string,
  meanings: readonly string[],
];

export interface ChineseDictionaryPack {
  readonly entries: ReadonlyMap<string, ChineseDictionaryEntry>;
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export interface ChineseDictionaryMetadata {
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

const MEANING_SEPARATOR = '\u001f';
const prefixBuckets = new WeakMap<
  ChineseDictionaryPack['entries'],
  ReadonlyMap<number, readonly string[]>
>();

// Built while immutable snapshots are loaded, outside the input/render path.
// Hand-written packs retain their live Map semantics through the fallback.
export function chineseSuggestionHeadwords(
  pack: ChineseDictionaryPack,
  query: string,
): Iterable<string> {
  return (
    prefixBuckets.get(pack.entries)?.get(query.codePointAt(0) ?? -1) ??
    (prefixBuckets.has(pack.entries) ? [] : pack.entries.keys())
  );
}

export function createChineseDictionaryPack(
  snapshot: string,
  metadata: ChineseDictionaryMetadata,
): ChineseDictionaryPack {
  const entries = new Map<string, ChineseDictionaryEntry>();
  const buckets = new Map<number, string[]>();
  const rows = snapshot.split('\n');
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;

    const fields = row.split('\t');
    const headword = fields[0];
    const pinyin = fields[1];
    const category = fields[2];
    const meanings = fields[3];
    if (!headword || pinyin === undefined || category === undefined || meanings === undefined)
      continue;
    if (!entries.has(headword)) {
      const prefix = headword.codePointAt(0) ?? -1;
      const bucket = buckets.get(prefix);
      if (bucket) bucket.push(headword);
      else buckets.set(prefix, [headword]);
    }
    entries.set(headword, [pinyin, category, meanings.split(MEANING_SEPARATOR)]);
  }

  prefixBuckets.set(entries, buckets);
  return { ...metadata, entries, entryCount: entries.size };
}

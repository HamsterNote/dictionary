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

export function createChineseDictionaryPack(
  snapshot: string,
  metadata: ChineseDictionaryMetadata,
): ChineseDictionaryPack {
  const entries = new Map<string, ChineseDictionaryEntry>();
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
    entries.set(headword, [pinyin, category, meanings.split(MEANING_SEPARATOR)]);
  }

  return { ...metadata, entries, entryCount: entries.size };
}

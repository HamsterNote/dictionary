export type EnglishChineseEntry = readonly [phonetic: string, translation: string];

export interface EnglishChineseVocabularyPack {
  readonly entries: ReadonlyMap<string, EnglishChineseEntry>;
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export interface EnglishChineseVocabularyMetadata {
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export function createEnglishChineseVocabularyPack(
  snapshot: string,
  metadata: EnglishChineseVocabularyMetadata,
): EnglishChineseVocabularyPack {
  const entries = new Map<string, EnglishChineseEntry>();
  const rows = snapshot.split('\n');
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;

    const firstTab = row.indexOf('\t');
    const secondTab = row.indexOf('\t', firstTab + 1);
    if (firstTab < 1 || secondTab < 0) continue;

    entries.set(row.slice(0, firstTab), [
      row.slice(firstTab + 1, secondTab),
      row.slice(secondTab + 1),
    ]);
  }

  return { ...metadata, entries, entryCount: entries.size };
}

const SYNONYM_SEPARATOR = '\u001f';

export interface EnglishSynonymPack {
  readonly entries: ReadonlyMap<string, readonly string[]>;
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export interface EnglishSynonymMetadata {
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export function createEnglishSynonymPack(
  snapshot: string,
  metadata: EnglishSynonymMetadata,
): EnglishSynonymPack {
  const entries = new Map<string, readonly string[]>();
  const rows = snapshot.split('\n');
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;

    const firstTab = row.indexOf('\t');
    if (firstTab < 1) continue;
    entries.set(row.slice(0, firstTab), row.slice(firstTab + 1).split(SYNONYM_SEPARATOR));
  }

  return { ...metadata, entries, entryCount: entries.size };
}

export interface EnglishDerivationRoot {
  readonly affix: string;
  readonly base: string;
  readonly sourcePartOfSpeech: string;
  readonly targetPartOfSpeech: string;
}

export interface EnglishRootPack {
  readonly entries: ReadonlyMap<string, readonly EnglishDerivationRoot[]>;
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export interface EnglishRootMetadata {
  readonly entryCount: number;
  readonly gzipBytes: number;
  readonly id: string;
  readonly label: string;
}

export function createEnglishRootPack(
  snapshot: string,
  metadata: EnglishRootMetadata,
): EnglishRootPack {
  const entries = new Map<string, EnglishDerivationRoot[]>();
  const rows = snapshot.split('\n');
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;
    const [word, base, affix, sourcePartOfSpeech, targetPartOfSpeech] = row.split('\t');
    if (!word || !base || !affix || !sourcePartOfSpeech || !targetPartOfSpeech) continue;
    const derivation = { affix, base, sourcePartOfSpeech, targetPartOfSpeech };
    const current = entries.get(word);
    if (current === undefined) entries.set(word, [derivation]);
    else current.push(derivation);
  }
  return { ...metadata, entries, entryCount: entries.size };
}

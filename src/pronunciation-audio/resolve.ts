import {
  type PronunciationAudioEntry,
  type PronunciationAudioManifest,
  type PronunciationContext,
  type PronunciationResolution,
  type PronunciationUnavailableReason,
  normalizePronunciationWord,
  pronunciationPhoneticFingerprint,
} from './contracts';

function unavailable(reason: PronunciationUnavailableReason): PronunciationResolution {
  return { status: 'unavailable', reason };
}

function matchesIdentity(entry: PronunciationAudioEntry, context: PronunciationContext): boolean {
  if (entry.scope.kind === 'legacy-unique') return context.entryId === undefined;
  return context.entryId === entry.scope.entryId && context.role === entry.scope.role;
}

export function resolvePronunciationAudio(
  manifest: PronunciationAudioManifest,
  context: PronunciationContext,
): PronunciationResolution {
  if (context.language !== 'en') return unavailable('unsupported-language');
  const word = normalizePronunciationWord(context.word);
  const phoneticFingerprint = pronunciationPhoneticFingerprint(context.phonetic);
  const wordEntries = manifest.entries.filter(
    (entry) => normalizePronunciationWord(entry.word) === word,
  );
  if (wordEntries.length === 0) return unavailable('not-found');
  const readingEntries = wordEntries.filter(
    (entry) => entry.phoneticFingerprint === phoneticFingerprint,
  );
  if (readingEntries.length === 0) return unavailable('reading-mismatch');

  const scopedEntries = readingEntries.filter((entry) => matchesIdentity(entry, context));
  if (scopedEntries.length === 0) return unavailable('scope-unknown');
  if (
    context.entryId === undefined &&
    scopedEntries.some((entry) => entry.scope.kind === 'entry')
  ) {
    return unavailable('scope-unknown');
  }

  const accentEntries =
    context.accent === undefined
      ? scopedEntries
      : scopedEntries.filter((entry) => entry.accent === context.accent);
  if (accentEntries.length === 0) return unavailable('accent-mismatch');
  if (
    context.accent === undefined &&
    new Set(accentEntries.map((entry) => entry.accent)).size > 1
  ) {
    return unavailable('accent-unknown');
  }

  const uniqueMappings = new Map(
    accentEntries.map((entry) => [`${entry.assetId}\n${entry.accent}`, entry] as const),
  );
  if (uniqueMappings.size !== 1) return unavailable('scope-unknown');
  const entry = accentEntries[0];
  if (entry === undefined) return unavailable('scope-unknown');
  const asset = manifest.assets.find((candidate) => candidate.assetId === entry.assetId);
  return asset === undefined ? unavailable('not-found') : { status: 'available', entry, asset };
}

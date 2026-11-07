import { createContext } from 'react';
import type { PronunciationDisplayEntry } from './DictionaryPronunciationOverlay';
import type { PronunciationAccent, PronunciationContext } from './pronunciation-audio/contracts';

export const PronunciationOverlayPlaybackContext = createContext<
  ((context: PronunciationContext | undefined) => void) | undefined
>(undefined);

function overlayAccent(
  accent: PronunciationDisplayEntry['readings'][number]['accent'],
): PronunciationAccent | undefined {
  if (accent.unspecified) return 'unspecified';
  if (accent.class === 'uk-unspecified') return 'uk';
  if (accent.class === 'us-unspecified') return 'us';
  return undefined;
}

export function resolveOverlayPronunciationContext(
  entries: readonly PronunciationDisplayEntry[],
): PronunciationContext | undefined {
  const displayed = entries
    .filter((entry) => (entry.blockedReasons?.length ?? 0) === 0)
    .flatMap((entry) =>
      entry.readings
        .filter((reading) => reading.tier === 'default')
        .map((reading) => ({ entry, reading })),
    );
  if (displayed.length !== 1) return undefined;
  const selected = displayed[0];
  if (selected === undefined) return undefined;
  const { entry, reading } = selected;
  const language = entry.conditions.language;
  const accent = overlayAccent(reading.accent);
  if (
    language.kind !== 'known' ||
    language.values.length !== 1 ||
    language.values[0] !== 'en' ||
    accent === undefined ||
    reading.originalIpa.trim() === '' ||
    reading.entryId !== entry.entryId ||
    reading.role !== entry.role ||
    reading.word !== entry.word
  ) {
    return undefined;
  }
  return {
    word: reading.word,
    language: 'en',
    phonetic: reading.originalIpa,
    entryId: reading.entryId,
    role: reading.role,
    accent,
  };
}

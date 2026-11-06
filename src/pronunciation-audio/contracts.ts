export const PRONUNCIATION_AUDIO_SCHEMA = 'pronunciation-audio/1' as const;

export const PRONUNCIATION_AUDIO_LICENSES = [
  'Public-Domain',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-3.0',
  'CC-BY-SA-4.0',
] as const;

export type PronunciationAudioLicenseSpdx = (typeof PRONUNCIATION_AUDIO_LICENSES)[number];
export type PronunciationAccent = 'uk' | 'us' | 'unspecified';
export type PronunciationRole = 'base' | 'present' | 'past' | 'past-participle';

export interface PronunciationAudioMedia {
  readonly url: string;
  readonly mime: 'audio/mpeg' | 'audio/ogg' | 'application/ogg' | 'audio/webm' | 'audio/mp4';
  readonly bytes: number;
  readonly durationSeconds?: number;
}

export interface PronunciationAudioLicense {
  readonly spdx: PronunciationAudioLicenseSpdx;
  readonly name: string;
  readonly url: string;
}

export interface PronunciationAudioAsset {
  readonly assetId: string;
  readonly pageUrl: string;
  readonly revisionId: number;
  readonly digest: string;
  readonly metadataSha256: string;
  readonly author: string;
  readonly license: PronunciationAudioLicense;
  readonly changes: string;
  readonly media: readonly PronunciationAudioMedia[];
}

export interface PronunciationAudioEvidence {
  readonly wiktionaryPageUrl: string;
  readonly wiktionaryRevisionId: number;
  readonly sourcePhonetic: string;
  readonly responseSha256: string;
  readonly association: 'wiktionary-pronunciation-section';
  readonly branch: {
    readonly relation: 'ancestor' | 'accent';
    readonly ipaLine: number;
    readonly audioLine: number;
    readonly ipaAccents: readonly string[];
    readonly audioAccents: readonly string[];
  };
  readonly verifiedAt: string;
  readonly verifiedBy: string;
  readonly reviewNote: string;
}

export type PronunciationAudioScope =
  | {
      readonly kind: 'legacy-unique';
      readonly verified: true;
    }
  | {
      readonly kind: 'entry';
      readonly entryId: string;
      readonly role: PronunciationRole;
      readonly readingRef: string;
    };

export interface PronunciationAudioEntry {
  readonly word: string;
  readonly language: 'en';
  readonly phonetic: string;
  readonly phoneticFingerprint: string;
  readonly accent: PronunciationAccent;
  readonly scope: PronunciationAudioScope;
  readonly assetId: string;
  readonly evidence: PronunciationAudioEvidence;
}

export interface PronunciationAudioManifest {
  readonly manifestVersion: typeof PRONUNCIATION_AUDIO_SCHEMA;
  readonly generatedAt: string;
  readonly entries: readonly PronunciationAudioEntry[];
  readonly assets: readonly PronunciationAudioAsset[];
}

export interface PronunciationContext {
  readonly word: string;
  readonly language: string;
  readonly phonetic: string;
  readonly entryId?: string;
  readonly role?: PronunciationRole;
  readonly accent?: PronunciationAccent;
}

export type PronunciationUnavailableReason =
  | 'unsupported-language'
  | 'not-found'
  | 'reading-mismatch'
  | 'scope-unknown'
  | 'accent-mismatch'
  | 'accent-unknown';

export type PronunciationResolution =
  | {
      readonly status: 'available';
      readonly entry: PronunciationAudioEntry;
      readonly asset: PronunciationAudioAsset;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: PronunciationUnavailableReason;
    };

export function normalizePronunciationWord(word: string): string {
  return word.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export function normalizePronunciationPhonetic(phonetic: string): string {
  return phonetic.normalize('NFC').trim();
}

export function pronunciationPhoneticFingerprint(phonetic: string): string {
  let hash = 0xcbf29ce484222325n;
  const normalized = normalizePronunciationPhonetic(phonetic);
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= BigInt(normalized.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

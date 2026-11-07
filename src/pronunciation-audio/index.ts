import manifestJson from './data/pronunciation-audio.json';
import { parsePronunciationAudioManifest } from './validate';

export * from './contracts';
export { resolvePronunciationAudio } from './resolve';
export { parsePronunciationAudioManifest, validatePronunciationAudioManifest } from './validate';

export const pronunciationAudioManifest = parsePronunciationAudioManifest(manifestJson);

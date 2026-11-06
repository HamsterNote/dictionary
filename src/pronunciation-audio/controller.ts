import type { PronunciationContext, PronunciationResolution } from './contracts';

export type PronunciationPlaybackStatus = 'idle' | 'loading' | 'playing' | 'unavailable' | 'error';
export type PronunciationPlaybackError =
  | 'offline'
  | 'timeout'
  | 'network'
  | 'resource'
  | 'unsupported-format'
  | 'decode'
  | 'gesture'
  | 'playback';

export interface PronunciationPlaybackState {
  readonly status: PronunciationPlaybackStatus;
  readonly contextKey?: string;
  readonly error?: PronunciationPlaybackError;
}

export interface PronunciationPlaybackController {
  readonly resolve: (context: PronunciationContext) => PronunciationResolution;
  readonly play: (context: PronunciationContext) => Promise<void>;
  readonly stop: () => void;
  readonly dispose: () => void;
  readonly getState: () => PronunciationPlaybackState;
  readonly subscribe: (listener: (state: PronunciationPlaybackState) => void) => () => void;
}

export function pronunciationContextKey(context: PronunciationContext): string {
  return JSON.stringify([
    context.word,
    context.language,
    context.phonetic,
    context.entryId,
    context.role,
    context.accent,
  ]);
}

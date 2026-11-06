import { Button } from '@hamster-note/components/button';
import { useEffect, useId, useState } from 'react';
import type { PronunciationContext } from './pronunciation-audio/contracts';
import {
  type PronunciationPlaybackController,
  type PronunciationPlaybackState,
  pronunciationContextKey,
} from './pronunciation-audio/controller';

interface PronunciationAudioButtonProps {
  readonly context: PronunciationContext;
  readonly pronunciation: PronunciationPlaybackController;
}

function feedback(available: boolean, state: PronunciationPlaybackState): string {
  if (!available) return '暂无读音';
  if (state.status === 'loading') return '正在准备读音';
  if (state.status === 'playing') return '正在播放';
  if (state.status !== 'error') return '';
  switch (state.error) {
    case 'offline':
      return '联网后可播放';
    case 'gesture':
      return '请再次点击播放';
    case 'unsupported-format':
      return '当前平台不支持该录音格式，请点击重试';
    case 'timeout':
      return '准备或播放超时，请点击重试';
    case 'network':
    case 'resource':
    case 'decode':
    case 'playback':
    case undefined:
      return '无法播放读音，请点击重试';
  }
  return '无法播放读音，请点击重试';
}

export function PronunciationAudioButton({
  context,
  pronunciation,
}: PronunciationAudioButtonProps) {
  const statusId = useId();
  const contextKey = pronunciationContextKey(context);
  const resolution = pronunciation.resolve(context);
  const [observedState, setObservedState] = useState<PronunciationPlaybackState>(() =>
    pronunciation.getState(),
  );
  useEffect(() => pronunciation.subscribe(setObservedState), [pronunciation, contextKey]);
  const state =
    observedState.contextKey === contextKey ? observedState : { status: 'idle' as const };
  const available = resolution.status === 'available';
  const busy = state.status === 'loading' || state.status === 'playing';
  const message = feedback(available, state);

  return (
    <>
      <Button
        aria-busy={state.status === 'loading'}
        aria-describedby={statusId}
        aria-label={busy ? `正在准备或播放 ${context.word}` : `朗读 ${context.word}`}
        className="dictionary-popover__pronunciation"
        disabled={!available || busy}
        ghost
        onClick={() => {
          void pronunciation.play(context);
        }}
        size="small"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 9.5h3.25L13 5.75v12.5L8.25 14.5H5z" />
          <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      </Button>
      <span
        aria-live="polite"
        className="dictionary-popover__pronunciation-feedback"
        id={statusId}
        role="status"
      >
        {message}
      </span>
      {resolution.status === 'available' ? (
        <details className="dictionary-popover__audio-source">
          <summary>音频来源</summary>
          <p>
            作者：{resolution.asset.author}；许可：
            <a href={resolution.asset.license.url} rel="noreferrer" target="_blank">
              {resolution.asset.license.name}
            </a>
          </p>
          <p>
            <a href={resolution.asset.pageUrl} rel="noreferrer" target="_blank">
              Commons 来源页
            </a>
            （文件版本 {String(resolution.asset.revisionId)}）
          </p>
          <p>变更：{resolution.asset.changes}</p>
          <p>Wiktionary 读法核对：{resolution.entry.evidence.reviewNote}</p>
        </details>
      ) : null}
    </>
  );
}

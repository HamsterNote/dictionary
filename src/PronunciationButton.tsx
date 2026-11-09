import { Button } from '@hamster-note/components/button';
import { useEffect, useId, useRef, useState } from 'react';
import type { DictionaryPronounce, DictionaryPronounceOptions } from './dictionaryPronounce';

interface PronunciationButtonProps {
  readonly pronounce: DictionaryPronounce;
  readonly word: string;
  readonly options?: DictionaryPronounceOptions | undefined;
}

type PronunciationStatus = 'idle' | 'busy' | 'error';

export function PronunciationButton({ pronounce, word, options }: PronunciationButtonProps) {
  const [status, setStatus] = useState<PronunciationStatus>('idle');
  const statusId = useId();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  return (
    <>
      <Button
        aria-busy={status === 'busy'}
        aria-describedby={status === 'error' ? statusId : undefined}
        aria-label={status === 'busy' ? `正在准备或播放 ${word}` : `朗读 ${word}`}
        className="dictionary-popover__pronunciation"
        disabled={status === 'busy'}
        ghost
        onClick={() => {
          setStatus('busy');
          const current = new AbortController();
          request.current?.abort();
          request.current = current;
          const play = async () => {
            await pronounce(word, current.signal, options);
          };
          void play().then(
            () => {
              if (!current.signal.aborted) setStatus('idle');
            },
            (error: unknown) => {
              if (!current.signal.aborted)
                setStatus(error instanceof Error && error.name === 'AbortError' ? 'idle' : 'error');
            },
          );
        }}
        size="small"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 9.5h3.25L13 5.75v12.5L8.25 14.5H5z" />
          <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      </Button>
      <span aria-live="polite" className="dictionary-popover__status" id={statusId} role="status">
        {status === 'error' ? `无法朗读 ${word}，请稍后重试。` : ''}
      </span>
    </>
  );
}

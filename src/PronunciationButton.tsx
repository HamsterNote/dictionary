import { Button } from '@hamster-note/components/button';
import { useId, useState } from 'react';

interface PronunciationButtonProps {
  readonly pronounce: (word: string) => Promise<void>;
  readonly word: string;
}

type PronunciationStatus = 'idle' | 'busy' | 'error';

export function PronunciationButton({ pronounce, word }: PronunciationButtonProps) {
  const [status, setStatus] = useState<PronunciationStatus>('idle');
  const statusId = useId();

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
          void pronounce(word).then(
            () => {
              setStatus('idle');
            },
            () => {
              setStatus('error');
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

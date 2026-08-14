import { Icon } from '@hamster-note/components/icon';
import { Popover } from '@hamster-note/components/popover';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DictionaryLicenseInfo as DictionaryLicenseInfoValue } from './dictionaryLicenseInfo';

interface DictionaryLicenseInfoProps {
  readonly dictionaryLabel: string;
  readonly license: DictionaryLicenseInfoValue;
}

const CLOSE_DELAY_MS = 120;

export function DictionaryLicenseInfo({ dictionaryLabel, license }: DictionaryLicenseInfoProps) {
  const descriptionId = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current === undefined) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const close = useCallback(() => {
    cancelScheduledClose();
    setIsOpen(false);
  }, [cancelScheduledClose]);

  const open = useCallback(() => {
    cancelScheduledClose();
    setIsOpen(true);
  }, [cancelScheduledClose]);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = undefined;
    }, CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);

  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  useEffect(() => {
    if (!isOpen || anchor === null) return;

    const closeOnOutsideInteraction = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor.contains(target) || popoverRef.current?.contains(target)) return;
      cancelScheduledClose();
      setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      cancelScheduledClose();
      setIsOpen(false);
      anchor.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [anchor, cancelScheduledClose, isOpen]);

  return (
    <>
      <span className="vocabulary-picker__license-row">
        <span className="vocabulary-picker__license-badge">{license.label}</span>
        <button
          aria-describedby={isOpen ? descriptionId : undefined}
          aria-expanded={isOpen}
          aria-label={`查看 ${dictionaryLabel} 的协议说明`}
          className="vocabulary-picker__license-trigger"
          onBlur={scheduleClose}
          onClick={open}
          onFocus={open}
          onPointerEnter={open}
          onPointerLeave={scheduleClose}
          ref={setAnchor}
          type="button"
        >
          <Icon aria-hidden="true" name="info" />
        </button>
      </span>
      {isOpen && anchor !== null ? (
        <Popover
          anchor={anchor}
          anchorOffset={6}
          className="vocabulary-picker__license-popover"
          id={descriptionId}
          onPointerEnter={cancelScheduledClose}
          onPointerLeave={scheduleClose}
          orientation="vertical"
          placement="bottom-end"
          ref={popoverRef}
          role="tooltip"
          theme="light"
          viewportMargin={8}
        >
          <p className="vocabulary-picker__license-source">{license.source}</p>
          <p className="vocabulary-picker__license-detail">{license.detail}</p>
          {license.requiresUpstreamReview ? (
            <p className="vocabulary-picker__license-caveat">* 需进一步复核上游授权链</p>
          ) : null}
          <a
            aria-label={`查看 ${license.source} 的协议原文（新窗口打开）`}
            className="vocabulary-picker__license-link"
            href={license.sourceLicenseUrl}
            onClick={close}
            rel="noreferrer"
            target="_blank"
          >
            <Icon aria-hidden="true" name="link" />
            查看源协议
          </a>
        </Popover>
      ) : null}
    </>
  );
}

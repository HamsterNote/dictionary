import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface DictionaryModalDialogProps {
  readonly children: ReactNode;
  readonly description?: string;
  readonly descriptionId: string;
  readonly onClose: () => void;
  readonly open: boolean;
  /** 打开后聚焦的目标选择器；缺省聚焦整个面板。 */
  readonly initialFocusSelector?: string;
  /** 宿主实例的主题变量；Portal 挂载在 body 上，必须显式传递才能继承当前实例的配色。 */
  readonly themeStyle?: CSSProperties | undefined;
  readonly title: ReactNode;
  readonly titleId: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]';

/** 词典内共享的无障碍模态框：焦点陷阱、Escape 关闭、关闭后焦点还原。 */
export function DictionaryModalDialog({
  children,
  description,
  descriptionId,
  initialFocusSelector,
  onClose,
  open,
  themeStyle,
  title,
  titleId,
}: DictionaryModalDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    restoreFocusRef.current = previouslyFocused instanceof HTMLElement ? previouslyFocused : null;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel === null) return;
      const target =
        initialFocusSelector === undefined
          ? panel
          : panel.querySelector<HTMLElement>(initialFocusSelector);
      (target ?? panel).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [initialFocusSelector, open]);

  useEffect(() => {
    if (open) return;
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (target !== null && document.contains(target)) target.focus();
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (panel === null) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) =>
        element.getAttribute('aria-hidden') !== 'true' && !element.hasAttribute('hidden'),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === panel || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="dictionary-correction" style={themeStyle}>
      {/* 遮罩仅响应点击；键盘用户通过 Escape 关闭 */}
      <div
        aria-hidden="true"
        className="dictionary-correction__backdrop"
        onClick={() => {
          onClose();
        }}
      />
      <div
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="dictionary-correction__panel"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="dictionary-correction__title" id={titleId}>
          {title}
        </h2>
        <button
          aria-label="关闭对话框"
          className="dictionary-correction__close"
          onClick={onClose}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.75"
            viewBox="0 0 16 16"
            width="16"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        {description === undefined ? null : (
          <p className="dictionary-correction__description" id={descriptionId}>
            {description}
          </p>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

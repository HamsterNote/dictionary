import { Button } from '@hamster-note/components/button';
import type { CSSProperties } from 'react';
import { useCallback, useRef, useState } from 'react';
import { DictionaryIpaKeyboard, type DictionaryIpaKeyboardAction } from './DictionaryIpaKeyboard';
import { DictionaryModalDialog } from './DictionaryModalDialog';
import {
  applyPhoneticAction,
  applyPhoneticForwardDelete,
  type PhoneticEditResult,
} from './phoneticEditing';

export interface DictionaryCorrectionDialogProps {
  /** 词典原始音标（无任何补丁时的值），用于判断补丁是否退化为空。 */
  readonly originalPhonetic: string;
  /** 词典原始词头，仅用于标题与存储键。 */
  readonly originalWord: string;
  readonly onClose: () => void;
  /** 传入的音标补丁值，或 null 表示清除纠错；宿主负责与既有 user 补丁合并。 */
  readonly onSave: (phoneticPatch: string | null) => void;
  readonly open: boolean;
  /** 当前生效的音标（含补丁）。 */
  readonly phonetic: string;
  /** 宿主实例的主题变量（Portal 继承配色）。 */
  readonly themeStyle?: CSSProperties | undefined;
}

const TITLE_ID = 'dictionary-correction-title';
const DESCRIPTION_ID = 'dictionary-correction-description';

export function DictionaryCorrectionDialog({
  onClose,
  onSave,
  open,
  originalPhonetic,
  originalWord,
  phonetic,
  themeStyle,
}: DictionaryCorrectionDialogProps) {
  const phoneticInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(phonetic);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [session, setSession] = useState({ open, originalPhonetic, phonetic });
  if (
    session.open !== open ||
    session.originalPhonetic !== originalPhonetic ||
    session.phonetic !== phonetic
  ) {
    setSession({ open, originalPhonetic, phonetic });
    setDraft(phonetic);
    setErrorMessage(undefined);
    setIsSaving(false);
  }

  const commitDraft = useCallback((updater: (current: string) => PhoneticEditResult) => {
    setDraft((current) => {
      const result = updater(current);
      setErrorMessage(undefined);
      requestAnimationFrame(() => {
        const input = phoneticInputRef.current;
        input?.focus();
        input?.setSelectionRange(result.cursor, result.cursor);
      });
      return result.value;
    });
  }, []);

  const handlePhoneticAction = useCallback(
    (action: DictionaryIpaKeyboardAction) => {
      const input = phoneticInputRef.current;
      const start = input?.selectionStart ?? null;
      const end = input?.selectionEnd ?? null;
      commitDraft((current) => {
        const safeStart = Math.min(start ?? current.length, current.length);
        const safeEnd = Math.min(end ?? current.length, current.length);
        return applyPhoneticAction(current, safeStart, safeEnd, action);
      });
    },
    [commitDraft],
  );

  const handlePhoneticDelete = useCallback(
    (direction: 'backward' | 'forward') => {
      const input = phoneticInputRef.current;
      const start = input?.selectionStart ?? null;
      const end = input?.selectionEnd ?? null;
      commitDraft((current) => {
        const safeStart = Math.min(start ?? current.length, current.length);
        const safeEnd = Math.min(end ?? current.length, current.length);
        return direction === 'backward'
          ? applyPhoneticAction(current, safeStart, safeEnd, { kind: 'backspace' })
          : applyPhoneticForwardDelete(current, safeStart, safeEnd);
      });
    },
    [commitDraft],
  );

  const handlePhoneticKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      handlePhoneticDelete('backward');
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      handlePhoneticDelete('forward');
      return;
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
  };

  const save = (): void => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      const trimmed = draft.trim();
      onSave(trimmed === originalPhonetic ? null : trimmed);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存失败，请重试。');
      setIsSaving(false);
    }
  };

  const reset = (): void => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      onSave(null);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '清除失败，请重试。');
      setIsSaving(false);
    }
  };

  return (
    <DictionaryModalDialog
      description="本期仅支持纠正音标。修改保存在本机，仅影响显示；词条查找仍使用原始拼写。"
      descriptionId={DESCRIPTION_ID}
      initialFocusSelector='[data-correction-field="phonetic"]'
      onClose={onClose}
      open={open}
      themeStyle={themeStyle}
      title={`纠错词条：${originalWord}`}
      titleId={TITLE_ID}
    >
      <div className="dictionary-correction__fields">
        <label className="dictionary-correction__field">
          <span className="dictionary-correction__label">音标</span>
          <input
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="dictionary-correction__input dictionary-correction__input--phonetic"
            data-correction-field="phonetic"
            inputMode="none"
            onKeyDown={handlePhoneticKeyDown}
            readOnly
            ref={phoneticInputRef}
            spellCheck={false}
            type="text"
            value={draft}
          />
          <p className="dictionary-correction__hint">
            使用下方键盘输入，系统软键盘已禁用；← → 移动光标，⌫ 删除。
          </p>
          {originalPhonetic === draft.trim() ? null : (
            <span className="dictionary-correction__original">
              原始：{originalPhonetic === '' ? '（无）' : originalPhonetic}
            </span>
          )}
        </label>
        <DictionaryIpaKeyboard onAction={handlePhoneticAction} />
      </div>
      {errorMessage === undefined ? null : (
        <p className="dictionary-correction__error" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="dictionary-correction__actions">
        <Button ghost onClick={reset} type="button">
          清除此词纠错
        </Button>
        <span className="dictionary-correction__actions-spacer" />
        <Button ghost onClick={onClose} type="button">
          取消
        </Button>
        <Button disabled={isSaving} onClick={save} type="button" variant="primary">
          {isSaving ? '保存中…' : '保存纠错'}
        </Button>
      </div>
    </DictionaryModalDialog>
  );
}

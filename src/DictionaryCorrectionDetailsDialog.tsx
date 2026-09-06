import { Button } from '@hamster-note/components/button';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { DictionaryModalDialog } from './DictionaryModalDialog';
import type { DictionaryCorrectedField } from './dictionaryCorrections';

const FIELD_LABELS: Record<DictionaryCorrectedField['field'], string> = {
  meaning: '释义',
  phonetic: '音标',
  word: '拼写',
};

const ORIGIN_LABELS: Record<DictionaryCorrectedField['origin'], string> = {
  system: '系统纠错',
  user: '我的纠错',
};

const TITLE_ID = 'dictionary-correction-details-title';
const DESCRIPTION_ID = 'dictionary-correction-details-description';

export interface DictionaryCorrectionDetailsDialogProps {
  readonly changes: readonly DictionaryCorrectedField[];
  readonly onClose: () => void;
  readonly onDelete?: (() => void) | undefined;
  readonly open: boolean;
  /** 宿主实例的主题变量（Portal 继承配色）。 */
  readonly themeStyle?: CSSProperties | undefined;
  readonly word: string;
}

interface DictionaryCorrectionDetailsContentProps {
  readonly changes: readonly DictionaryCorrectedField[];
  readonly onClose: () => void;
  readonly onDelete?: (() => void) | undefined;
}

export function DictionaryCorrectionDetailsContent({
  changes,
  onClose,
  onDelete,
}: DictionaryCorrectionDetailsContentProps) {
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteCorrection = (): void => {
    if (onDelete === undefined || isDeleting) return;
    setIsDeleting(true);
    setErrorMessage(undefined);
    try {
      onDelete();
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '删除失败，请重试。');
      setIsDeleting(false);
    }
  };

  return (
    <>
      <dl className="dictionary-correction-details__list">
        {changes.map((change) => (
          <div className="dictionary-correction-details__row" key={change.field}>
            <dt>{FIELD_LABELS[change.field]}</dt>
            <dd>
              <del>{change.before === '' ? '（无）' : change.before}</del>
              <span aria-hidden="true"> → </span>
              <ins>{change.after}</ins>
              <span className="dictionary-correction-details__origin">
                {ORIGIN_LABELS[change.origin]}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {errorMessage === undefined ? null : (
        <p className="dictionary-correction__error" role="alert">
          {errorMessage}
        </p>
      )}
      {onDelete === undefined ? null : (
        <div className="dictionary-correction__actions">
          <Button disabled={isDeleting} ghost onClick={deleteCorrection} type="button">
            {isDeleting ? '删除中…' : '删除纠错'}
          </Button>
        </div>
      )}
    </>
  );
}

export function DictionaryCorrectionDetailsDialog({
  changes,
  onClose,
  onDelete,
  open,
  themeStyle,
  word,
}: DictionaryCorrectionDetailsDialogProps) {
  return (
    <DictionaryModalDialog
      description={
        <>
          以下字段与词典原始内容不同；查找与导航始终使用
          <span className="dictionary-correction__keep-together">原始词头</span>。
        </>
      }
      descriptionId={DESCRIPTION_ID}
      onClose={onClose}
      open={open}
      themeStyle={themeStyle}
      title={`${word} 的纠错详情`}
      titleId={TITLE_ID}
    >
      <DictionaryCorrectionDetailsContent
        changes={changes}
        onClose={onClose}
        onDelete={onDelete}
      />
    </DictionaryModalDialog>
  );
}

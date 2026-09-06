import type { CSSProperties } from 'react';
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
  readonly open: boolean;
  /** 宿主实例的主题变量（Portal 继承配色）。 */
  readonly themeStyle?: CSSProperties | undefined;
  readonly word: string;
}

export function DictionaryCorrectionDetailsDialog({
  changes,
  onClose,
  open,
  themeStyle,
  word,
}: DictionaryCorrectionDetailsDialogProps) {
  return (
    <DictionaryModalDialog
      description="以下字段与词典原始内容不同；查找与导航始终使用原始词头。"
      descriptionId={DESCRIPTION_ID}
      onClose={onClose}
      open={open}
      themeStyle={themeStyle}
      title={`${word} 的纠错详情`}
      titleId={TITLE_ID}
    >
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
    </DictionaryModalDialog>
  );
}

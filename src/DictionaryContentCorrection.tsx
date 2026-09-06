import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DictionaryCorrectionDialog } from './DictionaryCorrectionDialog';
import type { ResolvedDictionaryCorrectionsControl } from './dictionaryCorrections';
import {
  mergeDictionaryPhoneticCorrection,
  resolveDictionaryCorrection,
} from './dictionaryCorrections';
import type { DictionaryCorrectionsManager } from './useDictionaryCorrections';

interface DictionaryContentCorrectionProps {
  /** 词条原始词头，纠错存储与标题都使用它。 */
  readonly activeKeyword: string;
  readonly corrections: ResolvedDictionaryCorrectionsControl;
  /** 词条原始音标（无任何补丁时的值）。 */
  readonly originalPhonetic: string;
  /** 当前生效的音标（含补丁）。 */
  readonly phonetic: string;
  readonly store: DictionaryCorrectionsManager;
  /** 宿主实例的主题变量，供 Portal 对话框继承配色。 */
  readonly themeStyle: CSSProperties;
}

/** 词条头旁的纠错入口与音标编辑对话框。 */
export function DictionaryContentCorrection({
  activeKeyword,
  corrections,
  originalPhonetic,
  phonetic,
  store,
  themeStyle,
}: DictionaryContentCorrectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (corrections.disabled || !corrections.editable) return null;

  return (
    <>
      <button
        aria-label={`纠错词条 ${activeKeyword}`}
        className="dictionary-popover__correction-trigger"
        onClick={() => {
          setIsDialogOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        纠错
      </button>
      <DictionaryCorrectionDialog
        onClose={() => {
          setIsDialogOpen(false);
          triggerRef.current?.focus();
        }}
        onSave={(phoneticPatch) => {
          const existingUserPatch = resolveDictionaryCorrection(activeKeyword, {
            user: store.user,
          })?.patch;
          store.save(
            activeKeyword,
            mergeDictionaryPhoneticCorrection(
              existingUserPatch,
              phoneticPatch ?? originalPhonetic,
              originalPhonetic,
            ),
          );
        }}
        open={isDialogOpen}
        originalPhonetic={originalPhonetic}
        originalWord={activeKeyword}
        phonetic={phonetic}
        themeStyle={themeStyle}
      />
    </>
  );
}

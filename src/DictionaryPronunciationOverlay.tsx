import { useId, useRef, useState } from 'react';
import type {
  ApplicabilityScope,
  GrammarRole,
  PronunciationDisplayDto,
} from './pronunciation-overlay/contracts';
import type { ScopedCorrectionsControl } from './pronunciation-overlay/corrections';
import {
  canEditScopedCorrections,
  submitScopedCorrection,
  validateScopedCorrection,
} from './pronunciation-overlay/corrections';
import { DictionaryModalDialog } from './DictionaryModalDialog';
import { DictionaryIpaKeyboard } from './DictionaryIpaKeyboard';
import { applyPhoneticAction } from './phoneticEditing';
import { Button } from '@hamster-note/components/button';

export interface PronunciationDisplayEntry {
  readonly entryId: string;
  readonly word: string;
  readonly role: GrammarRole;
  readonly conditions: ApplicabilityScope;
  readonly readings: readonly (PronunciationDisplayDto & {
    readonly rawTags?: readonly string[];
  })[];
  readonly blockedReasons?: readonly string[];
}
export interface DictionaryPronunciationOverlayProps {
  readonly entries: readonly PronunciationDisplayEntry[];
  readonly corrections?: ScopedCorrectionsControl;
  readonly onVerify?:
    ((entryId: string, conditions: ApplicabilityScope) => void | Promise<void>) | undefined;
}
const ROLE_LABELS: Record<GrammarRole, string> = {
  base: '原形',
  present: '一般现在时',
  past: '过去式',
  'past-participle': '过去分词',
};
const USAGE_LABELS = { rare: '罕见', archaic: '古旧', obsolete: '已废弃' };

function Reading({ reading }: { readonly reading: PronunciationDisplayEntry['readings'][number] }) {
  return (
    <li className="dictionary-pronunciations__reading">
      <span className="dictionary-pronunciations__ipa">
        {reading.originalIpa || '（有意清空）'}
      </span>
      <span>{reading.accent.unspecified ? '未注明口音' : reading.accent.label}</span>
      {reading.usage.map((usage) => (
        <span key={usage}>{USAGE_LABELS[usage]}</span>
      ))}
      {reading.rawTags?.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
      {reading.reviewStatus === 'due' ? (
        <span>待复核</span>
      ) : reading.reviewStatus === 'pending-review' ? (
        <span>复核时间未知</span>
      ) : null}
      <details className="dictionary-pronunciations__attribution">
        <summary>来源</summary>
        <a href={reading.attribution.pageUrl} target="_blank" rel="noreferrer">
          来源页
        </a>{' '}
        <a href={reading.attribution.historyUrl} target="_blank" rel="noreferrer">
          作者历史
        </a>{' '}
        <a href={reading.attribution.licenseUrl} target="_blank" rel="noreferrer">
          {reading.attribution.licenseSpdx}
        </a>
        <p>{reading.attribution.changeNotice}</p>
        {reading.origin === 'qualified-source' ? (
          <p>Wiktionary 衍生音标按 CC BY-SA 4.0 提供。</p>
        ) : null}
        {reading.tier === 'evidence-only' ? (
          <p>片段证据，未作完整读法</p>
        ) : reading.tier === 'unresolved' ? (
          <p>范围待确认，未生效</p>
        ) : null}
      </details>
    </li>
  );
}

export function DictionaryPronunciationOverlay({
  entries,
  corrections,
  onVerify,
}: DictionaryPronunciationOverlayProps) {
  const id = useId();
  const [editing, setEditing] = useState<PronunciationDisplayEntry>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const eligible = (entry: PronunciationDisplayEntry): boolean => {
    if ((entry.blockedReasons?.length ?? 0) > 0) return false;
    try {
      validateScopedCorrection({
        entryId: entry.entryId,
        conditions: entry.conditions,
        phonetic: '',
      });
      return true;
    } catch {
      return false;
    }
  };
  const save = async (): Promise<void> => {
    if (pending.current || editing === undefined || corrections === undefined) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await submitScopedCorrection(corrections, {
        entryId: editing.entryId,
        conditions: editing.conditions,
        phonetic: draft.trim(),
      });
      setEditing(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const verify = async (entry: PronunciationDisplayEntry): Promise<void> => {
    if (pending.current || !eligible(entry)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onVerify?.(entry.entryId, entry.conditions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '核验失败');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="dictionary-pronunciations">
      {entries.map((entry) => (
        <section aria-label={`${entry.word} · ${ROLE_LABELS[entry.role]}`} key={entry.entryId}>
          <div className="dictionary-pronunciations__heading">
            <h3>{ROLE_LABELS[entry.role]}</h3>
            {canEditScopedCorrections(corrections) && eligible(entry) ? (
              <button
                className="dictionary-popover__correction-trigger"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(entry);
                  setDraft(
                    entry.readings.find((reading) => reading.tier === 'default')?.originalIpa ?? '',
                  );
                  setError('');
                }}
              >
                纠错该读音
              </button>
            ) : null}
            {onVerify !== undefined && eligible(entry) ? (
              <button
                className="dictionary-popover__correction-trigger"
                type="button"
                disabled={busy}
                onClick={() => {
                  void verify(entry);
                }}
              >
                确认核验
              </button>
            ) : null}
          </div>
          {(entry.blockedReasons?.length ?? 0) > 0 ? (
            <p role="status">旧音标纠错归属尚未确认，新读法暂未启用</p>
          ) : (
            <>
              <ul>
                {entry.readings
                  .filter((reading) => reading.tier === 'default')
                  .map((reading, index) => (
                    <Reading reading={reading} key={index} />
                  ))}
              </ul>
              {entry.readings.some((reading) => reading.tier === 'supplemental') ? (
                <details>
                  <summary>更多读法</summary>
                  <ul>
                    {entry.readings
                      .filter((reading) => reading.tier === 'supplemental')
                      .map((reading, index) => (
                        <Reading reading={reading} key={index} />
                      ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
          {entry.readings.some((reading) =>
            ['unresolved', 'evidence-only'].includes(reading.tier),
          ) || (entry.blockedReasons?.length ?? 0) > 0 ? (
            <details>
              <summary>候选与证据</summary>
              <ul>
                {entry.readings
                  .filter(
                    (reading) =>
                      (entry.blockedReasons?.length ?? 0) > 0 ||
                      ['unresolved', 'evidence-only'].includes(reading.tier),
                  )
                  .map((reading, index) => (
                    <Reading
                      reading={{
                        ...reading,
                        tier: reading.tier === 'evidence-only' ? 'evidence-only' : 'unresolved',
                      }}
                      key={index}
                    />
                  ))}
              </ul>
            </details>
          ) : null}
        </section>
      ))}
      {error && editing === undefined ? <p role="alert">{error}</p> : null}
      <DictionaryModalDialog
        open={editing !== undefined}
        onClose={() => {
          if (!pending.current) setEditing(undefined);
        }}
        title={`纠错读音：${editing?.word ?? ''} · ${editing === undefined ? '' : ROLE_LABELS[editing.role]}`}
        titleId={`${id}-title`}
        descriptionId={`${id}-description`}
        initialFocusSelector="textarea"
      >
        <label className="dictionary-correction__field">
          音标
          <textarea
            aria-label="音标"
            ref={input}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            className="dictionary-correction__input"
          />
        </label>
        <DictionaryIpaKeyboard
          onAction={(action) => {
            const result = applyPhoneticAction(
              draft,
              input.current?.selectionStart ?? draft.length,
              input.current?.selectionEnd ?? draft.length,
              action,
            );
            setDraft(result.value);
            requestAnimationFrame(() => {
              input.current?.focus();
              input.current?.setSelectionRange(result.cursor, result.cursor);
            });
          }}
        />
        {error ? <p role="alert">{error}</p> : null}
        <div className="dictionary-correction__actions">
          <Button
            ghost
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(undefined);
            }}
          >
            取消
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={busy}
            onClick={() => {
              void save();
            }}
          >
            {busy ? '保存中' : '保存纠错'}
          </Button>
        </div>
      </DictionaryModalDialog>
    </div>
  );
}

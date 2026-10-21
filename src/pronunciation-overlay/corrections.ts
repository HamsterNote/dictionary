import type { ApplicabilityScope } from './contracts';
import { isOpaqueIdFormat, validateApplicabilityScope } from './contracts';
import { scopeCovers } from './resolve';

export const SCOPED_CORRECTION_STORAGE_KEY = 'hamster-dictionary-scoped-corrections/v2';
export interface ScopedCorrection {
  readonly entryId: string;
  readonly conditions: ApplicabilityScope;
  readonly phonetic: string;
}
export interface ScopedCorrectionsControl {
  readonly disabled?: boolean;
  readonly values: readonly ScopedCorrection[];
  readonly onChange?: (next: readonly ScopedCorrection[]) => void | Promise<void>;
}

export function validateScopedCorrection(value: unknown): asserts value is ScopedCorrection {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('无效 scoped 纠错');
  const record = value as Partial<ScopedCorrection>;
  const issues: Parameters<typeof validateApplicabilityScope>[2] = [];
  validateApplicabilityScope(record.conditions, '$', issues);
  if (
    typeof record.entryId !== 'string' ||
    !isOpaqueIdFormat(record.entryId) ||
    !record.entryId.startsWith('ent_') ||
    typeof record.phonetic !== 'string' ||
    issues.length > 0 ||
    record.conditions?.entry.kind !== 'known' ||
    record.conditions.entry.values.length !== 1 ||
    record.conditions.entry.values[0] !== record.entryId ||
    Object.values(record.conditions).some((constraint) => constraint.kind === 'unknown')
  ) {
    throw new Error('纠错必须绑定有效 entry ID 与完整明确条件');
  }
}

export function canEditScopedCorrections(control?: ScopedCorrectionsControl): boolean {
  return control?.disabled !== true && control?.onChange !== undefined;
}

export async function submitScopedCorrection(
  control: ScopedCorrectionsControl,
  correction: ScopedCorrection,
): Promise<void> {
  if (!canEditScopedCorrections(control)) throw new Error('缺少 scoped 持久化回调');
  validateScopedCorrection(correction);
  const values = control.values.filter(
    (value) =>
      value.entryId !== correction.entryId ||
      !scopeCovers(value.conditions, correction.conditions) ||
      !scopeCovers(correction.conditions, value.conditions),
  );
  await control.onChange?.([...values, correction]);
}

export function createScopedCorrectionStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let cache: readonly ScopedCorrection[] | undefined;
  return {
    load(): readonly ScopedCorrection[] {
      if (cache !== undefined) return structuredClone(cache);
      const raw = storage.getItem(SCOPED_CORRECTION_STORAGE_KEY);
      const document: unknown =
        raw === null ? { schema: SCOPED_CORRECTION_STORAGE_KEY, values: [] } : JSON.parse(raw);
      if (typeof document !== 'object' || document === null || Array.isArray(document))
        throw new Error('无效 scoped 文档');
      const record = document as { readonly schema?: unknown; readonly values?: unknown };
      if (record.schema !== SCOPED_CORRECTION_STORAGE_KEY || !Array.isArray(record.values)) {
        throw new Error('scoped 存储版本或数据无效');
      }
      cache = record.values.map((value: unknown) => {
        validateScopedCorrection(value);
        return value;
      });
      return structuredClone(cache);
    },
    save(values: readonly ScopedCorrection[]): void {
      for (const value of values) validateScopedCorrection(value);
      storage.setItem(
        SCOPED_CORRECTION_STORAGE_KEY,
        JSON.stringify({ schema: SCOPED_CORRECTION_STORAGE_KEY, values }),
      );
      cache = structuredClone(values);
    },
  };
}

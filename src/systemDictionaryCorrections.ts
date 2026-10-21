import rawSystemCorrections from './data/dictionarySystemCorrections.json';
import rawSystemPronunciationRules from './data/dictionarySystemPronunciationRules.json';
import type { DictionaryCorrectionMap } from './dictionaryCorrections';
import { sanitizeDictionaryCorrectionMap } from './dictionaryCorrections';

/**
 * 随包分发的系统级纠错表，数据本体在 `data/dictionarySystemCorrections.json`。
 * 数据收录已确认的词库勘误；后续新增条目必须逐条注明来源并评审。
 * 字段优先级：用户纠错 > 系统纠错 > 词典原文。
 *
 * 音标纠错的唯一权威是 `data/dictionarySystemPronunciationRules.json`，
 * 本文件的 phonetic 字段由 `scripts/project_system_pronunciation_rules.mjs`
 * 确定性投影生成，不要手改。
 */
export const SYSTEM_DICTIONARY_CORRECTIONS: DictionaryCorrectionMap =
  sanitizeDictionaryCorrectionMap(rawSystemCorrections);

/** 每条系统纠错的逐项归因（13.4）：宿主可读的来源/许可/变更声明。 */
export interface SystemCorrectionAttribution {
  readonly attribution: string;
  readonly changeNotice: string;
  readonly historyUrl: string;
  readonly licenseId: string;
  readonly licenseUrl: string;
  readonly pageUrl: string;
}

interface AuthorityEvidenceRef {
  readonly attribution?: string;
  readonly historyUrl?: string;
  readonly license?: { readonly id?: string; readonly url?: string };
  readonly permalinkUrl?: string;
  /** 历史依据的原始来源地址（如 Oxford 词条页）。 */
  readonly url?: string;
}

interface AuthorityRule {
  readonly evidenceRefs?: readonly AuthorityEvidenceRef[];
  readonly lifecycle?: {
    readonly approvalRef?: { readonly batch?: string; readonly kind?: string };
    readonly migratedFromLegacy?: boolean;
  };
  readonly reviewStatus?: string;
  readonly target: { readonly kind: string; readonly word?: string };
}

function buildSystemCorrectionAttribution(): Readonly<
  Record<string, SystemCorrectionAttribution>
> {
  const authority = rawSystemPronunciationRules as { readonly rules: readonly AuthorityRule[] };
  const map: Record<string, SystemCorrectionAttribution> = {};
  for (const rule of authority.rules) {
    if (rule.target.kind !== 'legacy-headword' || typeof rule.target.word !== 'string') {
      continue;
    }
    // 与投影器同一准入：历史迁移或已批准 active 规则才有正式归因条目；
    // 显式撤销/替代的规则除外（与 project_system_pronunciation_rules.mjs 一致）。
    if (rule.reviewStatus === 'revoked' || rule.reviewStatus === 'replaced') continue;
    const projectable =
      rule.lifecycle?.migratedFromLegacy === true ||
      (rule.reviewStatus === 'active' &&
        rule.lifecycle?.approvalRef?.kind === 'batch-approval');
    if (!projectable) continue;
    const evidence = rule.evidenceRefs?.[0];
    // 历史条目来源取记录在案的 evidenceRefs.url（如 Oxford）；确实没有记录
    // 来源时如实标 unknown，绝不构造一个看似官方的地址。
    const pageUrl =
      evidence?.permalinkUrl ?? evidence?.url ?? 'unknown';
    map[rule.target.word] = {
      pageUrl,
      historyUrl: evidence?.historyUrl ?? 'unknown',
      licenseId: evidence?.license?.id ?? 'unknown',
      licenseUrl: evidence?.license?.url ?? 'unknown',
      attribution: evidence?.attribution ?? 'unknown',
      changeNotice:
        rule.lifecycle?.migratedFromLegacy === true
          ? '历史系统纠错（保真迁移自 dictionarySystemCorrections.json）'
          : `按批次批准修正音标（${rule.lifecycle?.approvalRef?.batch ?? 'unknown batch'}）`,
    };
  }
  return map;
}

/**
 * 逐词头归因表：page/history/许可/变更声明。与投影器同一准入规则，
 * 只覆盖正式生效的系统纠错；草稿与未批准规则不出现。
 */
export const SYSTEM_CORRECTION_ATTRIBUTION: Readonly<
  Record<string, SystemCorrectionAttribution>
> = buildSystemCorrectionAttribution();

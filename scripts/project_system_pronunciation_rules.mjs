#!/usr/bin/env node
/**
 * 系统音标权威投影器（dictionarySystemPronunciationRules.json → 派生物）。
 *
 * 唯一权威是 src/data/dictionarySystemPronunciationRules.json；
 * dictionarySystemCorrections.json 与 overlay 规则视图都是它的确定性派生。
 *
 * 用法：
 *   node scripts/project_system_pronunciation_rules.mjs
 *       投影并校验（默认 --check）：权威音标补丁合并进旧 JSON 后应与正式文件
 *       逐字节一致、authority 记录的 legacyProjectionSha256（补丁哈希）与投影
 *       一致，任一不符（版本混配或手改派生 phonetic）退出 1。旧 JSON 中
 *       word/meaning 与无规则条目原样保留、仍按既有流程手工维护。
 *   node scripts/project_system_pronunciation_rules.mjs --write-legacy
 *       用合并结果重写 dictionarySystemCorrections.json（权威变更后刻意执行）。
 *   node scripts/project_system_pronunciation_rules.mjs --overlay-view
 *       输出 overlay 规则视图 JSON 到 stdout（同源派生，含归因摘要）。
 *
 * 投影准入（保守，缺一即拒）：
 *   - 历史迁移规则（lifecycle.migratedFromLegacy + grandfathered 批准引用）；
 *   - 或 reviewStatus=active 且带 batch-approval 批准引用的规则。
 *   pending 草稿、无批准、缺 CC BY-SA 4.0 permalink/history 证据的新规则
 *   一律不投影。多值/多写同一字段、无法无损映射旧 JSON 的规则记入
 *   legacy-projection-blocked，绝不任取 first。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const AUTHORITY_PATH = new URL('../src/data/dictionarySystemPronunciationRules.json', import.meta.url);
const LEGACY_PATH = new URL('../src/data/dictionarySystemCorrections.json', import.meta.url);

const AUTHORITY_SCHEMA = 'dictionary-system-pronunciation-rules/1';
const RULE_SCHEMA = 'pronunciation-rule/1';
const REVIEW_STATUSES = new Set(['active', 'due', 'pending-review', 'revoked', 'replaced']);
const OPS = new Set(['set', 'clear', 'suppress']);
const FIELDS = new Set(['word', 'phonetic', 'meaning']);
const SCOPE_DIMS = ['language', 'entry', 'lexeme', 'role', 'pos', 'sense', 'accent', 'other'];
const CC_BY_SA_ID = 'CC BY-SA 4.0';
const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

export class ProjectionRejected extends Error {}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function fail(message) {
  throw new ProjectionRejected(message);
}

function validateScope(scope, path) {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    fail(`${path}: scope 必须是对象`);
  }
  if (scope.kind === 'known') {
    if (!Array.isArray(scope.values) || scope.values.length === 0
        || scope.values.some((v) => typeof v !== 'string' || v === '')) {
      fail(`${path}: known scope 必须有非空字符串 values`);
    }
  } else if (scope.kind === 'explicit-all') {
    if (!Array.isArray(scope.evidence) || scope.evidence.length === 0) {
      fail(`${path}: explicit-all scope 必须带证据引用`);
    }
  } else if (scope.kind === 'unknown') {
    if (typeof scope.reason !== 'string' || scope.reason === '') {
      fail(`${path}: unknown scope 必须带原因`);
    }
  } else {
    fail(`${path}: 非法 scope kind ${String(scope.kind)}`);
  }
}

function validateRule(rule, index) {
  const path = `rules[${index}]`;
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) fail(`${path}: 必须是对象`);
  if (rule.schema !== RULE_SCHEMA) fail(`${path}: schema 必须是 ${RULE_SCHEMA}`);
  if (typeof rule.ruleId !== 'string' || rule.ruleId === '') fail(`${path}: 缺 ruleId`);
  if (rule.origin !== 'system' && rule.origin !== 'user') fail(`${path}: 非法 origin`);
  const target = rule.target;
  if (typeof target !== 'object' || target === null) fail(`${path}: 缺 target`);
  if (target.kind !== 'legacy-headword' && target.kind !== 'entry') fail(`${path}: 非法 target.kind`);
  const word = target.kind === 'legacy-headword' ? target.word : target.entryId;
  if (typeof word !== 'string' || word === '' || word.length > 300) fail(`${path}: 非法目标词头`);
  if (!Array.isArray(rule.operations) || rule.operations.length === 0) fail(`${path}: 缺 operations`);
  const seenFields = new Set();
  for (const [opIndex, op] of rule.operations.entries()) {
    const opPath = `${path}.operations[${opIndex}]`;
    if (!FIELDS.has(op.field)) fail(`${opPath}: 非法 field`);
    if (seenFields.has(op.field)) fail(`${opPath}: 同一字段多次写入（拒绝任取 first）`);
    seenFields.add(op.field);
    if (!OPS.has(op.op)) fail(`${opPath}: 非法 op`);
    if (op.op === 'set') {
      if (typeof op.value !== 'string' || op.value === '' || op.value.length > 1000) {
        fail(`${opPath}: set 必须带非空 value`);
      }
    } else if (op.value !== undefined) {
      fail(`${opPath}: clear/suppress 不得带 value`);
    }
  }
  const conditions = rule.conditions;
  if (typeof conditions !== 'object' || conditions === null) fail(`${path}: 缺 conditions`);
  for (const dim of SCOPE_DIMS) validateScope(conditions[dim], `${path}.conditions.${dim}`);
  if (!REVIEW_STATUSES.has(rule.reviewStatus)) fail(`${path}: 非法 reviewStatus`);
  if (!Array.isArray(rule.evidenceRefs)) fail(`${path}: evidenceRefs 必须是数组`);
  const lifecycle = rule.lifecycle;
  if (typeof lifecycle !== 'object' || lifecycle === null) fail(`${path}: 缺 lifecycle`);
  if (typeof lifecycle.migratedFromLegacy !== 'boolean') fail(`${path}: lifecycle.migratedFromLegacy 必须是布尔`);
  const approval = lifecycle.approvalRef;
  if (rule.createdAt === undefined && typeof rule.createdAtUnknownReason !== 'string') {
    fail(`${path}: createdAt 缺失时必须给 createdAtUnknownReason（不得伪填时间）`);
  }
  if (rule.createdAt !== undefined && rule.createdAtUnknownReason !== undefined) {
    fail(`${path}: createdAt 与 createdAtUnknownReason 互斥`);
  }
  if (lifecycle.migratedFromLegacy) {
    if (approval?.kind !== 'grandfathered-legacy-correction') {
      fail(`${path}: 历史迁移规则必须用 grandfathered-legacy-correction 批准引用`);
    }
  } else {
    // 新增正式规则：逐条外部依据必须带 CC BY-SA 4.0 + permalink + history。
    const hasCompliantEvidence = (rule.evidenceRefs ?? []).some((ref) => (
      ref?.license?.id === CC_BY_SA_ID
      && ref?.license?.url === CC_BY_SA_URL
      && typeof ref?.permalinkUrl === 'string' && ref.permalinkUrl !== ''
      && typeof ref?.historyUrl === 'string' && ref.historyUrl !== ''
    ));
    if (!hasCompliantEvidence) {
      fail(`${path}: 新增正式规则缺 CC BY-SA 4.0 permalink/history 证据，拒绝收录`);
    }
    if (rule.reviewStatus === 'active' && approval?.kind !== 'batch-approval') {
      fail(`${path}: active 规则必须带 batch-approval 批准引用`);
    }
  }
  return rule;
}

export function loadAuthority(text) {
  let authority;
  try {
    authority = JSON.parse(text);
  } catch {
    fail('authority 不是合法 JSON');
  }
  if (authority.schema !== AUTHORITY_SCHEMA) fail(`authority schema 必须是 ${AUTHORITY_SCHEMA}`);
  if (!Number.isInteger(authority.rulesVersion) || authority.rulesVersion < 1) {
    fail('rulesVersion 必须是正整数');
  }
  if (typeof authority.legacyProjectionSha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(authority.legacyProjectionSha256)) {
    fail('authority 缺 legacyProjectionSha256');
  }
  if (!Array.isArray(authority.rules)) fail('rules 必须是数组');
  const seenIds = new Set();
  const seenWords = new Set();
  authority.rules.forEach((rule, index) => {
    validateRule(rule, index);
    if (seenIds.has(rule.ruleId)) fail(`ruleId 重复: ${rule.ruleId}`);
    seenIds.add(rule.ruleId);
    const word = rule.target.kind === 'legacy-headword' ? rule.target.word : rule.target.entryId;
    if (seenWords.has(word)) fail(`同一词头多条规则: ${word}`);
    seenWords.add(word);
  });
  return authority;
}

function isProjectable(rule) {
  // 显式撤销/替代的规则一律不投影——历史迁移身份不豁免失效状态。
  if (rule.reviewStatus === 'revoked' || rule.reviewStatus === 'replaced') return false;
  if (rule.lifecycle.migratedFromLegacy) return true;
  return rule.reviewStatus === 'active' && rule.lifecycle.approvalRef?.kind === 'batch-approval';
}

export function project(authority) {
  const patch = {};
  const blocked = [];
  const overlay = [];
  const overlayAccentNotes = [];
  for (const rule of authority.rules) {
    if (!isProjectable(rule)) continue; // 草稿/pending 不投影、不阻断
    if (rule.target.kind !== 'legacy-headword') {
      blocked.push({ ruleId: rule.ruleId, reason: 'legacy-projection-blocked:non-legacy-target' });
      continue;
    }
    const entry = {};
    let unsafe = null;
    for (const op of rule.operations) {
      if (op.field !== 'phonetic') {
        // word/meaning 仍按既有流程在旧 JSON 手工维护，不由音标权威投影。
        unsafe = `legacy-projection-blocked:field-${op.field}-hand-maintained`;
        break;
      }
      if (op.op !== 'set') {
        unsafe = `legacy-projection-blocked:op-${op.op}-not-representable`;
        break;
      }
      entry.phonetic = op.value;
    }
    const accent = rule.conditions.accent;
    // accent known 多值但 operation 单值 = 该 IPA 跨口音一致，对无 scope 的旧字段
    // 是无损映射（不是把多口音拼成单读法）；真正多值歧义不会到达这里（建议阶段
    // 已 unresolved）。保留 overlay 完整 scope，投影放行并记录说明。
    if (unsafe === null && accent.kind === 'known' && accent.values.length > 1) {
      overlayAccentNotes.push({ ruleId: rule.ruleId, accents: accent.values });
    }
    if (unsafe !== null) {
      blocked.push({ ruleId: rule.ruleId, reason: unsafe });
      continue;
    }
    patch[rule.target.word] = entry;
    overlay.push({
      ruleId: rule.ruleId,
      target: rule.target,
      operations: rule.operations,
      conditions: rule.conditions,
      evidenceRefs: rule.evidenceRefs,
      reviewStatus: rule.reviewStatus,
    });
  }
  const sortedPatch = Object.fromEntries(
    Object.keys(patch).sort().map((word) => [word, patch[word]]),
  );
  return {
    phoneticPatch: sortedPatch,
    patchSha256: sha256(`${JSON.stringify(sortedPatch, null, 2)}\n`),
    blocked,
    multiAccentSingleValue: overlayAccentNotes,
    overlayView: {
      schema: 'pronunciation-overlay-system-rules/1',
      sourceRulesVersion: authority.rulesVersion,
      attribution: {
        note: 'Derived from dictionarySystemPronunciationRules.json; per-rule evidenceRefs carry license/permalink/history.',
        licenses: [...new Set(authority.rules.flatMap((rule) => (rule.evidenceRefs ?? [])
          .map((ref) => ref?.license?.id ?? ref?.license?.reason ?? 'unknown')))].sort(),
      },
      rules: overlay,
    },
  };
}

/**
 * 把音标补丁合并进旧 JSON 文本：规则覆盖的词头只接管 phonetic 字段，
 * word/meaning 与无规则条目原样保留；输出保持 2 空格缩进 + 末尾换行。
 *
 * phonetic 的唯一来源是权威层（维护文档禁止手改派生 phonetic），因此
 * **不在补丁中的既有 phonetic 一律清除**（撤销/删除规则后旧派生不得残留）；
 * 清空后只剩空对象的条目整条移除，带 word/meaning 的手工条目保留其余字段。
 */
export function mergeLegacy(legacyText, phoneticPatch) {
  const legacy = JSON.parse(legacyText);
  for (const [word, entry] of Object.entries(legacy)) {
    if (Object.hasOwn(phoneticPatch, word)) continue;
    if (entry !== null && typeof entry === 'object' && 'phonetic' in entry) {
      const { phonetic: _dropped, ...rest } = entry;
      if (Object.keys(rest).length === 0) {
        delete legacy[word];
      } else {
        legacy[word] = rest;
      }
    }
  }
  for (const [word, patch] of Object.entries(phoneticPatch)) {
    legacy[word] = { ...(legacy[word] ?? {}), ...patch };
  }
  const sorted = Object.fromEntries(
    Object.keys(legacy).sort().map((word) => [word, legacy[word]]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function checkAuthorityAgainstLegacy(authorityText, legacyText) {
  const authority = loadAuthority(authorityText);
  const result = project(authority);
  const problems = [];
  const merged = mergeLegacy(legacyText, result.phoneticPatch);
  if (merged !== legacyText) {
    problems.push('dictionarySystemCorrections.json 与权威投影不一致（版本混配或手改派生 phonetic）');
  }
  if (result.patchSha256 !== authority.legacyProjectionSha256) {
    problems.push('authority 记录的 legacyProjectionSha256 与投影不符');
  }
  return { authority, result, problems };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const authorityText = readFileSync(AUTHORITY_PATH, 'utf8');
  const legacyText = readFileSync(LEGACY_PATH, 'utf8');
  const { authority, result, problems } = checkAuthorityAgainstLegacy(authorityText, legacyText);
  if (args.has('--overlay-view')) {
    process.stdout.write(`${JSON.stringify(result.overlayView, null, 2)}\n`);
    return;
  }
  if (args.has('--write-legacy')) {
    if (result.patchSha256 !== authority.legacyProjectionSha256) {
      console.error('拒绝写入：投影与 authority 记录的 legacyProjectionSha256 不符');
      process.exit(1);
    }
    writeFileSync(LEGACY_PATH, mergeLegacy(legacyText, result.phoneticPatch));
    console.log(`dictionarySystemCorrections.json 已按权威 rulesVersion=${authority.rulesVersion} 重写`);
    return;
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`NO-GO: ${problem}`);
    process.exit(1);
  }
  console.log(JSON.stringify({
    status: 'ok',
    rulesVersion: authority.rulesVersion,
    rules: authority.rules.length,
    projected: Object.keys(result.phoneticPatch).length,
    blocked: result.blocked,
    legacyProjectionSha256: authority.legacyProjectionSha256,
  }));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    if (error instanceof ProjectionRejected) {
      console.error(`NO-GO: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

export const _internals = { sha256, CC_BY_SA_ID, CC_BY_SA_URL };

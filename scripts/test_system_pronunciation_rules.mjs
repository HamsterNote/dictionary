#!/usr/bin/env node
/**
 * 系统音标权威层离线测试（纯 node，无 vite 依赖）。
 *
 * 覆盖 tasks 13.1/13.2 的衔接面：迁移保真、确定性兼容投影、版本混配阻断、
 * 草稿不投影、缺许可/缺批准拒新增、多值拒绝、回滚（旧权威重投影即恢复）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ProjectionRejected,
  checkAuthorityAgainstLegacy,
  loadAuthority,
  mergeLegacy,
  project,
  _internals,
} from './project_system_pronunciation_rules.mjs';

const AUTHORITY_PATH = new URL('../src/data/dictionarySystemPronunciationRules.json', import.meta.url);
const LEGACY_PATH = new URL('../src/data/dictionarySystemCorrections.json', import.meta.url);
const authorityText = readFileSync(AUTHORITY_PATH, 'utf8');
const legacyText = readFileSync(LEGACY_PATH, 'utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const authority = loadAuthority(authorityText);

test('迁移保真：三条历史纠正值与旧 JSON 完全一致', () => {
  const legacy = JSON.parse(legacyText);
  const migrated = authority.rules.filter((r) => r.lifecycle.migratedFromLegacy);
  assert.equal(migrated.length, 3);
  for (const rule of migrated) {
    const word = rule.target.word;
    const op = rule.operations.find((o) => o.field === 'phonetic');
    assert.equal(op.op, 'set');
    assert.equal(legacy[word].phonetic, op.value);
    assert.equal(rule.lifecycle.approvalRef.kind, 'grandfathered-legacy-correction');
    // 历史依据不冒充 CC BY-SA；时间缺失如实记录。
    assert.equal(rule.reviewStatus, 'pending-review');
    assert.equal(typeof rule.createdAtUnknownReason, 'string');
    assert.equal(rule.createdAt, undefined);
    for (const ref of rule.evidenceRefs) {
      assert.equal(ref.license.kind, 'unknown');
    }
    assert.ok(rule.lifecycle.legacyRawValue, `${word} 缺 ECDICT 原值记录`);
  }
});

test('第二批 61 条批准规则：active + batch-approval + CC BY-SA 证据齐全', () => {
  const batch = authority.rules.filter((r) => r.ruleId.startsWith('ham37-r2-'));
  assert.equal(batch.length, 61);
  for (const rule of batch) {
    assert.equal(rule.reviewStatus, 'active');
    assert.equal(rule.lifecycle.approvalRef.kind, 'batch-approval');
    assert.ok(rule.lifecycle.approvalRef.ref.includes('01a1595d-427d-726f-8d81-c8b6b7b48f73'));
    const ref = rule.evidenceRefs[0];
    assert.equal(ref.license.id, 'CC BY-SA 4.0');
    assert.ok(ref.permalinkUrl.includes('oldid='));
    assert.ok(ref.historyUrl.includes('action=history'));
    // B 口径落值抽查在投影层做；这里保证未定词不在内。
  }
  const heads = new Set(batch.map((r) => r.target.word));
  for (const absent of ['with', 'do', 'this', 'but', 'which', 'there']) {
    assert.ok(!heads.has(absent), `${absent} 是未定词，不应写入`);
  }
});

test('第三批 13 条批准规则：active + batch-approval 绑定选 A 评论，look 未写入', () => {
  const batch = authority.rules.filter((r) => r.ruleId.startsWith('ham37-r3-'));
  assert.equal(batch.length, 13);
  for (const rule of batch) {
    assert.equal(rule.reviewStatus, 'active');
    assert.equal(rule.lifecycle.approvalRef.kind, 'batch-approval');
    assert.ok(rule.lifecycle.approvalRef.ref.includes('01a159ad-1f6b-7739-8edc-522f6180a727'));
    assert.equal(rule.lifecycle.approvalRef.batch, 'ham37-third-round-v1');
    const ref = rule.evidenceRefs[0];
    assert.equal(ref.license.id, 'CC BY-SA 4.0');
    assert.ok(ref.permalinkUrl.includes('oldid='));
  }
  assert.ok(!authority.rules.some((r) => r.target.word === 'look'),
    'look 只有 phonetic 记法证据，不应写入');
});

test('兼容投影与正式文件逐字节一致（行为不变）', () => {
  const { result, problems } = checkAuthorityAgainstLegacy(authorityText, legacyText);
  assert.deepEqual(problems, []);
  assert.equal(mergeLegacy(legacyText, result.phoneticPatch), legacyText);
  assert.equal(result.patchSha256, authority.legacyProjectionSha256);
});

test('版本混配阻断：派生文件被改即拒绝', () => {
  const tampered = legacyText.replace('/ɡɒd/', '/ɡɑːd/');
  const { problems } = checkAuthorityAgainstLegacy(authorityText, tampered);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /不一致/u);
});

test('版本混配阻断：authority 内记录哈希被改即拒绝', () => {
  const forged = JSON.parse(authorityText);
  forged.legacyProjectionSha256 = '0'.repeat(64);
  const { problems } = checkAuthorityAgainstLegacy(JSON.stringify(forged), legacyText);
  assert.ok(problems.some((p) => p.includes('legacyProjectionSha256')));
});

test('草稿规则（pending、无批准）不投影', () => {
  const draft = JSON.parse(authorityText);
  draft.rules.push({
    schema: 'pronunciation-rule/1',
    ruleId: 'ham37-draft-unwritten',
    origin: 'system',
    target: { kind: 'legacy-headword', word: 'unwritten-draft' },
    operations: [{ field: 'phonetic', op: 'set', value: '/x/' }],
    conditions: {
      language: { kind: 'known', values: ['English'] },
      entry: { kind: 'known', values: ['Etymology 1'] },
      lexeme: { kind: 'unknown', reason: 'lexeme-not-determinable' },
      role: { kind: 'unknown', reason: 'role-not-determinable' },
      pos: { kind: 'unknown', reason: 'pos-not-determinable' },
      sense: { kind: 'unknown', reason: 'sense-not-determinable' },
      accent: { kind: 'known', values: ['Received Pronunciation'] },
      other: { kind: 'unknown', reason: 'no-qualifier' },
    },
    evidenceRefs: [{
      license: { id: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      permalinkUrl: 'https://en.wiktionary.org/w/index.php?title=unwritten-draft&oldid=1',
      historyUrl: 'https://en.wiktionary.org/w/index.php?title=unwritten-draft&action=history',
    }],
    lifecycle: {
      migratedFromLegacy: false,
      verification: { status: 'pending' },
      approvalRef: null,
    },
    createdAtUnknownReason: 'draft-pending-human-approval',
    reviewStatus: 'pending-review',
  });
  const result = project(loadAuthority(JSON.stringify(draft)));
  assert.equal(Object.keys(result.phoneticPatch).length, authority.rules.length);
  assert.ok(!result.overlayView.rules.some((r) => r.ruleId === 'ham37-draft-unwritten'));
});

test('新增正式规则缺 CC BY-SA permalink/history 证据即拒绝', () => {
  const bad = JSON.parse(authorityText);
  bad.rules.push({
    schema: 'pronunciation-rule/1',
    ruleId: 'bad-rule',
    origin: 'system',
    target: { kind: 'legacy-headword', word: 'bad' },
    operations: [{ field: 'phonetic', op: 'set', value: '/bæd/' }],
    conditions: Object.fromEntries(['language', 'entry', 'lexeme', 'role', 'pos', 'sense', 'accent', 'other']
      .map((d) => [d, { kind: 'unknown', reason: 'x' }])),
    evidenceRefs: [],
    lifecycle: { migratedFromLegacy: false, approvalRef: { kind: 'batch-approval', ref: 'x' } },
    createdAtUnknownReason: 'x',
    reviewStatus: 'pending-review',
  });
  assert.throws(() => loadAuthority(JSON.stringify(bad)), ProjectionRejected);
});

test('同一字段多次写入拒绝（不任取 first）', () => {
  const multi = JSON.parse(authorityText);
  multi.rules[0].operations.push({ field: 'phonetic', op: 'set', value: '/x/' });
  assert.throws(() => loadAuthority(JSON.stringify(multi)), /任取 first/u);
});

test('active 规则必须有 batch-approval 批准引用', () => {
  const forgedActive = JSON.parse(authorityText);
  const rule = forgedActive.rules[0];
  rule.lifecycle.migratedFromLegacy = false;
  rule.reviewStatus = 'active';
  rule.evidenceRefs = [{
    license: { id: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    permalinkUrl: 'https://en.wiktionary.org/w/index.php?title=curiosity&oldid=1',
    historyUrl: 'https://en.wiktionary.org/w/index.php?title=curiosity&action=history',
  }];
  assert.throws(() => loadAuthority(JSON.stringify(forgedActive)), /batch-approval/u);
});

test('撤销/删除权威后派生失效，恢复后重现（真实方向）', () => {
  // 删除已批准的 note 规则：重投影后补丁不含 note；合并进当前旧 JSON 必须
  // 清掉失去依据的 phonetic（整条移除，因为该条目只有 phonetic）。
  const without = JSON.parse(authorityText);
  without.rules = without.rules.filter((r) => r.target.word !== 'note');
  const reduced = project(loadAuthority(JSON.stringify(without)));
  assert.equal(reduced.phoneticPatch.note, undefined);
  const pruned = JSON.parse(mergeLegacy(legacyText, reduced.phoneticPatch));
  assert.equal(pruned.note, undefined, '删除权威后旧派生必须消失');
  assert.ok(Object.keys(pruned).length === Object.keys(JSON.parse(legacyText)).length - 1);
  // 恢复权威后重投影：note 精确回到原值。
  const restored = JSON.parse(mergeLegacy(JSON.stringify(pruned), project(authority).phoneticPatch));
  assert.equal(restored.note.phonetic, JSON.parse(legacyText).note.phonetic);
  // 显式撤销历史 god 规则：迁移身份不豁免，投影排除、派生被清除。
  const revoked = JSON.parse(authorityText);
  revoked.rules.find((r) => r.target.word === 'god').reviewStatus = 'revoked';
  const revokedResult = project(loadAuthority(JSON.stringify(revoked)));
  assert.equal(revokedResult.phoneticPatch.god, undefined);
  const prunedGod = JSON.parse(mergeLegacy(legacyText, revokedResult.phoneticPatch));
  assert.equal(prunedGod.god, undefined);
  // 手工维护的 word/meaning 条目不被投影或清理触碰。
  const withManual = JSON.parse(legacyText);
  withManual.example = { word: 'example', meaning: '手工释义纠正' };
  const merged = JSON.parse(mergeLegacy(`${JSON.stringify(withManual, null, 2)}\n`,
    project(authority).phoneticPatch));
  assert.deepEqual(merged.example, { word: 'example', meaning: '手工释义纠正' });
});

test('overlay 视图同源：规则与归因摘要来自同一权威', () => {
  const result = project(authority);
  assert.equal(result.overlayView.sourceRulesVersion, authority.rulesVersion);
  assert.equal(result.overlayView.rules.length, authority.rules.length);
  assert.ok(result.overlayView.attribution.licenses.includes('historical-reference-license-not-recorded'));
});

console.log(`\n${passed} passed`);

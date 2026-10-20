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
  assert.equal(authority.rules.length, 3);
  for (const rule of authority.rules) {
    const word = rule.target.word;
    const op = rule.operations.find((o) => o.field === 'phonetic');
    assert.equal(op.op, 'set');
    assert.equal(legacy[word].phonetic, op.value);
    assert.equal(rule.lifecycle.migratedFromLegacy, true);
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
    ruleId: 'ham37-r2-note',
    origin: 'system',
    target: { kind: 'legacy-headword', word: 'note' },
    operations: [{ field: 'phonetic', op: 'set', value: '/nəʊt/' }],
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
      permalinkUrl: 'https://en.wiktionary.org/w/index.php?title=note&oldid=93710887',
      historyUrl: 'https://en.wiktionary.org/w/index.php?title=note&action=history',
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
  assert.equal(Object.keys(result.phoneticPatch).length, 3);
  assert.ok(!result.overlayView.rules.some((r) => r.ruleId === 'ham37-r2-note'));
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

test('回滚：投影是权威+手工部分的纯函数，恢复旧权威即恢复旧派生', () => {
  const older = JSON.parse(authorityText);
  older.rules = older.rules.filter((r) => r.target.word !== 'god');
  const result = project(loadAuthority(JSON.stringify(older)));
  // 旧权威补丁不含 god；合并到任何基线都不会重写 god。
  assert.deepEqual(Object.keys(result.phoneticPatch).sort(), ['curiosity', 'pronunciation']);
  // 反向：当前权威补丁合并进缺 god 的旧基线，精确恢复该条目。
  const legacyWithoutGod = JSON.parse(legacyText);
  delete legacyWithoutGod.god;
  const restored = JSON.parse(mergeLegacy(`${JSON.stringify(legacyWithoutGod, null, 2)}\n`,
    project(authority).phoneticPatch));
  assert.deepEqual(restored.god, { phonetic: '/ɡɒd/' });
  // 手工维护的 word/meaning 条目不被投影触碰。
  const withManual = JSON.parse(legacyText);
  withManual.example = { word: 'example', meaning: '手工释义纠正' };
  const merged = JSON.parse(mergeLegacy(`${JSON.stringify(withManual, null, 2)}\n`,
    project(authority).phoneticPatch));
  assert.deepEqual(merged.example, { word: 'example', meaning: '手工释义纠正' });
});

test('overlay 视图同源：规则与归因摘要来自同一权威', () => {
  const result = project(authority);
  assert.equal(result.overlayView.sourceRulesVersion, authority.rulesVersion);
  assert.equal(result.overlayView.rules.length, 3);
  assert.ok(result.overlayView.attribution.licenses.includes('historical-reference-license-not-recorded'));
});

console.log(`\n${passed} passed`);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildPronunciationAudit } from './audit_ecdict_pronunciations.mjs';

const audit = await buildPronunciationAudit();
const committedAudit = JSON.parse(
  await readFile(new URL('./data/dictionary-pronunciation-audit.json', import.meta.url), 'utf8'),
);

// Given the ten generated vocabulary packs; When the audit is rebuilt; Then the committed artifact is deterministic.
assert.deepEqual(audit, committedAudit);
assert.deepEqual(Object.keys(audit.packs).sort(), [
  'bnc',
  'cet4',
  'cet6',
  'core',
  'gk',
  'gre',
  'ielts',
  'ky',
  'toefl',
  'zk',
]);

// Given overlapping packs; When unique headwords are classified; Then every headword has exactly one status.
const accountedHeadwords = [
  ...audit.headwords.missing,
  ...audit.headwords.notationFlag,
  ...audit.headwords.unresolved,
  ...audit.headwords.variants.map(({ word }) => word),
  ...audit.verifiedErrors.map(({ word }) => word),
];
assert.equal(accountedHeadwords.length, audit.totals.uniqueHeadwords);
assert.equal(new Set(accountedHeadwords).size, audit.totals.uniqueHeadwords);
assert.equal(audit.totals.packRows, 66_016);
assert.equal(audit.totals.uniqueHeadwords, 46_803);
assert.equal(
  Object.values(audit.packs).reduce((sum, pack) => sum + pack.missingPhoneticCount, 0),
  9_237,
);
assert.equal(
  Object.entries(audit.overlap.membershipCounts).reduce(
    (sum, [packCount, headwordCount]) => sum + Number(packCount) * headwordCount,
    0,
  ),
  audit.totals.packRows,
);
assert.ok(audit.overlap.pairwiseCounts['cet4|cet6'] > 0);
assert.equal(
  Object.values(audit.totals.statusCounts).reduce((sum, count) => sum + count, 0),
  audit.totals.uniqueHeadwords,
);

// Given evidence-reviewed errors; When corrections are audited; Then every shipped system patch matches its review.
const corrections = JSON.parse(
  await readFile(new URL('../src/data/dictionarySystemCorrections.json', import.meta.url), 'utf8'),
);
// 13.3 衔接：已发布 phonetic 必须逐条来自系统音标权威（迁移或批准规则）且同值；
// 审计 verifiedErrors 仍须全部在交付中且值不变。
const authority = JSON.parse(
  await readFile(new URL('../src/data/dictionarySystemPronunciationRules.json', import.meta.url), 'utf8'),
);
const authorityPhonetics = new Map(
  authority.rules
    .filter((rule) => rule.lifecycle.migratedFromLegacy
      || (rule.reviewStatus === 'active' && rule.lifecycle.approvalRef?.kind === 'batch-approval'))
    .map((rule) => [
      rule.target.word,
      rule.operations.find((op) => op.field === 'phonetic')?.value,
    ]),
);
for (const [word, patch] of Object.entries(corrections)) {
  if (patch.phonetic === undefined) continue;
  assert.equal(
    authorityPhonetics.get(word),
    patch.phonetic,
    `${word} 的已发布音标没有同值的权威规则背书`,
  );
}
for (const { correction, word } of audit.verifiedErrors) {
  assert.deepEqual(
    corrections[word],
    correction,
    `${word} 的已核验纠错必须原样交付`,
  );
}
for (const review of audit.verifiedErrors) {
  assert.ok(review.evidence.length >= 2, `${review.word} needs two independent evidence sources`);
  assert.ok(review.rawPhonetics.length > 0, `${review.word} must exist in a vocabulary pack`);
}
assert.deepEqual(audit.totals.pendingSignalCounts, {
  backslash: 137,
  caret: 710,
  cyrillicIe: 324,
  foreignNotation: 15,
});

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const PACK_IDS = ['core', 'zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre', 'bnc'];
const SNAPSHOT_COMMIT = 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b';
const SNAPSHOT_SHA256 = '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf';
const LEGACY_NOTATION = /[.':ә]/u;

const VERIFIED_REVIEWS = {
  curiosity: {
    correction: { phonetic: '/ˌkjʊəriˈɒsəti/' },
    finding:
      'The existing patch still used ECDICT legacy symbols; use Oxford’s standard UK IPA. The sources support the UK /kjʊə.r/ sequence; Oxford separately lists a US /kjʊr/ form.',
    previousCorrection: { phonetic: "/.kjuәri'ɒsəti/" },
    evidence: [
      {
        claim: 'Oxford lists UK /ˌkjʊəriˈɒsəti/ and US /ˌkjʊriˈɑːsəti/.',
        retrieved: '2026-09-06',
        url: 'https://www.oxfordlearnersdictionaries.com/definition/english/curiosity',
      },
      {
        claim: 'The Dictionary API response derived from Wiktionary gives /ˌkjʊəɹɪˈɒsɪti/.',
        retrieved: '2026-09-06',
        url: 'https://api.dictionaryapi.dev/api/v2/entries/en/curiosity',
      },
    ],
  },
  god: {
    correction: { phonetic: '/ɡɒd/' },
    finding:
      "ECDICT's '^ɔd' contains a corrupted initial consonant; both references begin with IPA /ɡ/.",
    evidence: [
      {
        claim: 'Oxford lists UK /ɡɒd/ and US /ɡɑːd/.',
        retrieved: '2026-09-06',
        url: 'https://www.oxfordlearnersdictionaries.com/definition/english/god_1',
      },
      {
        claim:
          'The Dictionary API response derived from Wiktionary includes /ɡɒd/ and other dialect variants, all beginning /ɡ/.',
        retrieved: '2026-09-06',
        url: 'https://api.dictionaryapi.dev/api/v2/entries/en/god',
      },
    ],
  },
  pronunciation: {
    correction: { phonetic: '/prəˌnʌnsiˈeɪʃn/' },
    finding:
      'ECDICT starts with /prəʊ-/, but both sources support standard /prə-/. Oxford directly supplies final IPA /ʃn/; Merriam-Webster uses its own shən notation rather than identical IPA.',
    evidence: [
      {
        claim: 'Oxford gives /prəˌnʌnsiˈeɪʃn/ for both listed varieties.',
        retrieved: '2026-09-06',
        url: 'https://www.oxfordlearnersdictionaries.com/definition/english/pronunciation',
      },
      {
        claim: 'Merriam-Webster gives prə-ˌnən(t)-sē-ˈā-shən and labels the /aʊ/ form nonstandard.',
        retrieved: '2026-09-06',
        url: 'https://www.merriam-webster.com/dictionary/pronunciation',
      },
    ],
  },
};

const PRESERVED_VARIANTS = {
  either: {
    decision:
      'Preserve the bundled pronunciation; reputable dictionaries recognize multiple standard forms.',
    evidence: [
      {
        claim: 'Oxford lists both /ˈaɪðə(r)/ and /ˈiːðə(r)/ as standard British forms.',
        retrieved: '2026-09-06',
        url: 'https://www.oxfordlearnersdictionaries.com/definition/english/either_1',
      },
    ],
  },
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const readPack = async (packId) => {
  const relativePath = `src/data/ecdict-${packId}.tsv`;
  const contents = await readFile(resolve(REPOSITORY_ROOT, relativePath), 'utf8');
  const [header, ...lines] = contents.trimEnd().split('\n');
  const headerMatch = header.match(
    /^# ECDICT ([0-9a-f]{40}) \| sha256 ([0-9a-f]{64}) \| pack ([a-z0-9]+) \| entries ([0-9]+)$/u,
  );
  assertAudit(headerMatch !== null, `${relativePath}: invalid generated header`);
  const [, commit, sourceSha256, headerPackId, entryCountText] = headerMatch;
  assertAudit(commit === SNAPSHOT_COMMIT, `${relativePath}: unexpected ECDICT commit`);
  assertAudit(sourceSha256 === SNAPSHOT_SHA256, `${relativePath}: unexpected source digest`);
  assertAudit(headerPackId === packId, `${relativePath}: pack id mismatch`);
  assertAudit(Number(entryCountText) === lines.length, `${relativePath}: entry count mismatch`);
  return {
    entries: lines.map((line) => {
      const [word, phonetic] = line.split('\t');
      assertAudit(
        typeof word === 'string' && typeof phonetic === 'string',
        `${relativePath}: malformed row`,
      );
      return { phonetic, word };
    }),
    metadata: {
      entryCount: lines.length,
      fileSha256: sha256(contents),
      missingPhoneticCount: lines.filter((line) => line.split('\t')[1] === '').length,
      path: relativePath,
    },
  };
};

function assertAudit(condition, message) {
  if (!condition) throw new TypeError(message);
}

export async function buildPronunciationAudit() {
  const loadedPacks = await Promise.all(PACK_IDS.map(readPack));
  const packs = {};
  const headwords = new Map();
  for (const [index, packId] of PACK_IDS.entries()) {
    const loadedPack = loadedPacks[index];
    assertAudit(loadedPack !== undefined, `${packId}: pack was not loaded`);
    packs[packId] = loadedPack.metadata;
    for (const { phonetic, word } of loadedPack.entries) {
      const record = headwords.get(word) ?? { packs: [], phonetics: new Set() };
      record.packs.push(packId);
      record.phonetics.add(phonetic);
      headwords.set(word, record);
    }
  }

  const missing = [];
  const notationFlag = [];
  const unresolved = [];
  const variants = [];
  const verifiedErrors = [];
  const pendingSignals = { backslash: [], caret: [], cyrillicIe: [], foreignNotation: [] };
  const membershipCounts = {};
  const pairwiseOverlapCounts = {};
  for (const [word, record] of [...headwords.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    membershipCounts[record.packs.length] = (membershipCounts[record.packs.length] ?? 0) + 1;
    for (const [packIndex, packId] of record.packs.entries()) {
      for (const otherPackId of record.packs.slice(packIndex + 1)) {
        const pair = [packId, otherPackId].sort().join('|');
        pairwiseOverlapCounts[pair] = (pairwiseOverlapCounts[pair] ?? 0) + 1;
      }
    }
    const rawPhonetics = [...record.phonetics].sort();
    if (rawPhonetics.some((phonetic) => phonetic.includes('\\')))
      pendingSignals.backslash.push(word);
    if (rawPhonetics.some((phonetic) => phonetic.includes('^'))) pendingSignals.caret.push(word);
    if (rawPhonetics.some((phonetic) => phonetic.includes('є')))
      pendingSignals.cyrillicIe.push(word);
    if (rawPhonetics.some((phonetic) => phonetic.includes('(?@)')))
      pendingSignals.foreignNotation.push(word);
    const verifiedReview = Object.hasOwn(VERIFIED_REVIEWS, word)
      ? VERIFIED_REVIEWS[word]
      : undefined;
    const preservedVariant = Object.hasOwn(PRESERVED_VARIANTS, word)
      ? PRESERVED_VARIANTS[word]
      : undefined;
    if (verifiedReview !== undefined) {
      verifiedErrors.push({ ...verifiedReview, packs: record.packs, rawPhonetics, word });
    } else if (preservedVariant !== undefined) {
      variants.push({ ...preservedVariant, packs: record.packs, rawPhonetics, word });
    } else if (rawPhonetics.every((phonetic) => phonetic === '')) {
      missing.push(word);
    } else if (rawPhonetics.some((phonetic) => LEGACY_NOTATION.test(phonetic))) {
      notationFlag.push(word);
    } else {
      unresolved.push(word);
    }
  }

  const statusCounts = {
    missing: missing.length,
    notationFlag: notationFlag.length,
    unresolved: unresolved.length,
    variants: variants.length,
    verifiedError: verifiedErrors.length,
  };
  return {
    schemaVersion: 1,
    source: {
      commit: SNAPSHOT_COMMIT,
      repository: 'https://github.com/skywind3000/ECDICT',
      sha256: SNAPSHOT_SHA256,
    },
    methodology: {
      notationFlag:
        "Non-empty transcription containing ECDICT's legacy '.', apostrophe, ':', or Cyrillic 'ә'; this is not a correctness verdict.",
      unresolved:
        'Non-empty transcription not manually verified and not caught by the legacy-notation flag.',
      scope:
        'Every unique headword in the ten vocabulary packs; generated inflection packs are excluded.',
    },
    packs,
    overlap: {
      membershipCounts,
      pairwiseCounts: Object.fromEntries(Object.entries(pairwiseOverlapCounts).sort()),
    },
    totals: {
      pendingSignalCounts: Object.fromEntries(
        Object.entries(pendingSignals).map(([signal, words]) => [signal, words.length]),
      ),
      packRows: Object.values(packs).reduce((sum, pack) => sum + pack.entryCount, 0),
      statusCounts,
      uniqueHeadwords: headwords.size,
    },
    pendingSignals,
    verifiedErrors,
    headwords: { missing, notationFlag, unresolved, variants },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes('--help')) {
    console.log('Usage: node scripts/audit_ecdict_pronunciations.mjs [--write]');
    process.exit(0);
  }
  const invalidArgument = arguments_.find((argument) => argument !== '--write');
  if (invalidArgument !== undefined) {
    console.error(`Unknown argument: ${invalidArgument}`);
    process.exit(2);
  }
  const audit = await buildPronunciationAudit();
  if (arguments_.includes('--write')) {
    const outputPath = resolve(SCRIPT_DIRECTORY, 'data/dictionary-pronunciation-audit.json');
    const rendered = await format(JSON.stringify(audit), { parser: 'json', printWidth: 100 });
    await writeFile(outputPath, rendered, 'utf8');
    console.log(`Wrote ${audit.totals.uniqueHeadwords} audited headwords to ${outputPath}`);
  } else {
    console.log(JSON.stringify(audit.totals, null, 2));
  }
}

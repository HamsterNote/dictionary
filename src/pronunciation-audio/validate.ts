import {
  PRONUNCIATION_AUDIO_LICENSES,
  PRONUNCIATION_AUDIO_SCHEMA,
  type PronunciationAudioManifest,
  pronunciationPhoneticFingerprint,
} from './contracts';

const MEDIA_MIMES = new Set([
  'audio/mpeg',
  'audio/ogg',
  'application/ogg',
  'audio/webm',
  'audio/mp4',
]);
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`${path} 必须是非空字符串`);
    return '';
  }
  return value;
}

function requirePositiveInteger(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    issues.push(`${path} 必须是正整数`);
  }
}

function requireHttpsUrl(
  value: unknown,
  path: string,
  issues: string[],
  allowedHosts?: readonly string[],
): void {
  const text = requireString(value, path, issues);
  if (text.length === 0) return;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) {
      issues.push(`${path} 必须是安全的 HTTPS URL`);
    } else if (allowedHosts !== undefined && !allowedHosts.includes(url.hostname)) {
      issues.push(`${path} 使用了未批准的 host`);
    }
  } catch {
    issues.push(`${path} 不是有效 URL`);
  }
}

function validateAsset(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} 必须是对象`);
    return;
  }
  const { assetId, pageUrl, revisionId, digest, metadataSha256, author, changes, license, media } =
    value;
  requireString(assetId, `${path}.assetId`, issues);
  requireHttpsUrl(pageUrl, `${path}.pageUrl`, issues, ['commons.wikimedia.org']);
  requirePositiveInteger(revisionId, `${path}.revisionId`, issues);
  const digestText = requireString(digest, `${path}.digest`, issues);
  if (!/^[a-f0-9]{40}$/u.test(digestText)) issues.push(`${path}.digest 必须是 Commons SHA-1`);
  const metadataSha256Text = requireString(metadataSha256, `${path}.metadataSha256`, issues);
  if (!/^[a-f0-9]{64}$/u.test(metadataSha256Text)) {
    issues.push(`${path}.metadataSha256 无效`);
  }
  requireString(author, `${path}.author`, issues);
  requireString(changes, `${path}.changes`, issues);
  if (!isRecord(license)) {
    issues.push(`${path}.license 必须是对象`);
  } else {
    const { spdx, name, url } = license;
    const spdxText = requireString(spdx, `${path}.license.spdx`, issues);
    if (!(PRONUNCIATION_AUDIO_LICENSES as readonly string[]).includes(spdxText)) {
      issues.push(`${path}.license.spdx 不在逐文件许可白名单`);
    }
    requireString(name, `${path}.license.name`, issues);
    requireHttpsUrl(url, `${path}.license.url`, issues);
  }
  if (!Array.isArray(media) || media.length === 0) {
    issues.push(`${path}.media 必须包含实际存在的媒体表示`);
    return;
  }
  const mediaKeys = new Set<string>();
  for (const [index, item] of media.entries()) {
    const mediaPath = `${path}.media[${String(index)}]`;
    if (!isRecord(item)) {
      issues.push(`${mediaPath} 必须是对象`);
      continue;
    }
    const { url, mime, bytes, durationSeconds } = item;
    requireHttpsUrl(url, `${mediaPath}.url`, issues, ['upload.wikimedia.org']);
    const mimeText = requireString(mime, `${mediaPath}.mime`, issues);
    if (!MEDIA_MIMES.has(mimeText)) issues.push(`${mediaPath}.mime 不受支持`);
    requirePositiveInteger(bytes, `${mediaPath}.bytes`, issues);
    if (typeof bytes === 'number' && bytes > MAX_MEDIA_BYTES) {
      issues.push(`${mediaPath}.bytes 超过 2 MiB 单项上限`);
    }
    if (durationSeconds !== undefined) {
      if (
        typeof durationSeconds !== 'number' ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > MAX_DURATION_SECONDS
      ) {
        issues.push(`${mediaPath}.durationSeconds 必须在 0–30 秒之间`);
      }
    }
    const key = `${mimeText}\n${String(url)}`;
    if (mediaKeys.has(key)) issues.push(`${mediaPath} 重复`);
    mediaKeys.add(key);
  }
}

function validateEntry(
  value: unknown,
  path: string,
  assetIds: Set<string>,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push(`${path} 必须是对象`);
    return;
  }
  const { word, language, phonetic, phoneticFingerprint, accent, scope, assetId, evidence } = value;
  requireString(word, `${path}.word`, issues);
  if (language !== 'en') issues.push(`${path}.language 仅支持 en`);
  const phoneticText = requireString(phonetic, `${path}.phonetic`, issues);
  const fingerprint = requireString(phoneticFingerprint, `${path}.phoneticFingerprint`, issues);
  if (phoneticText && fingerprint !== pronunciationPhoneticFingerprint(phoneticText)) {
    issues.push(`${path}.phoneticFingerprint 与当前 IPA 不符`);
  }
  if (!['uk', 'us', 'unspecified'].includes(String(accent))) {
    issues.push(`${path}.accent 无效`);
  }
  if (!isRecord(scope)) {
    issues.push(`${path}.scope 必须是对象`);
  } else if (scope['kind'] === 'legacy-unique') {
    if (scope['verified'] !== true) issues.push(`${path}.scope 旧接口映射必须显式核验`);
  } else if (scope['kind'] === 'entry') {
    requireString(scope['entryId'], `${path}.scope.entryId`, issues);
    requireString(scope['readingRef'], `${path}.scope.readingRef`, issues);
    if (!['base', 'present', 'past', 'past-participle'].includes(String(scope['role']))) {
      issues.push(`${path}.scope.role 无效`);
    }
  } else {
    issues.push(`${path}.scope.kind 不允许未知范围进入正式映射`);
  }
  const assetIdText = requireString(assetId, `${path}.assetId`, issues);
  if (assetIdText && !assetIds.has(assetIdText)) issues.push(`${path}.assetId 引用了不存在的资产`);
  if (!isRecord(evidence)) {
    issues.push(`${path}.evidence 必须是对象`);
    return;
  }
  const {
    wiktionaryPageUrl,
    wiktionaryRevisionId,
    sourcePhonetic,
    responseSha256,
    association,
    branch,
    verifiedAt,
    verifiedBy,
    reviewNote,
  } = evidence;
  requireHttpsUrl(wiktionaryPageUrl, `${path}.evidence.wiktionaryPageUrl`, issues, [
    'en.wiktionary.org',
  ]);
  requirePositiveInteger(wiktionaryRevisionId, `${path}.evidence.wiktionaryRevisionId`, issues);
  requireString(sourcePhonetic, `${path}.evidence.sourcePhonetic`, issues);
  const responseSha256Text = requireString(
    responseSha256,
    `${path}.evidence.responseSha256`,
    issues,
  );
  if (!/^[a-f0-9]{64}$/u.test(responseSha256Text)) {
    issues.push(`${path}.evidence.responseSha256 无效`);
  }
  if (association !== 'wiktionary-pronunciation-section') {
    issues.push(`${path}.evidence.association 必须关联音标所在发音段落`);
  }
  if (!isRecord(branch)) {
    issues.push(`${path}.evidence.branch 必须保留 IPA—口音—录音分支`);
  } else {
    if (!['ancestor', 'accent'].includes(String(branch['relation']))) {
      issues.push(`${path}.evidence.branch.relation 无效`);
    }
    requirePositiveInteger(branch['ipaLine'], `${path}.evidence.branch.ipaLine`, issues);
    requirePositiveInteger(branch['audioLine'], `${path}.evidence.branch.audioLine`, issues);
    for (const field of ['ipaAccents', 'audioAccents']) {
      const accents = branch[field];
      if (!Array.isArray(accents) || accents.some((accent) => typeof accent !== 'string')) {
        issues.push(`${path}.evidence.branch.${field} 必须是字符串数组`);
      }
    }
  }
  const verifiedAtText = requireString(verifiedAt, `${path}.evidence.verifiedAt`, issues);
  if (verifiedAtText && !Number.isFinite(Date.parse(verifiedAtText))) {
    issues.push(`${path}.evidence.verifiedAt 必须是有效时间`);
  }
  requireString(verifiedBy, `${path}.evidence.verifiedBy`, issues);
  requireString(reviewNote, `${path}.evidence.reviewNote`, issues);
}

export function validatePronunciationAudioManifest(value: unknown): readonly string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['manifest 必须是对象'];
  const { manifestVersion, generatedAt, assets, entries } = value;
  if (manifestVersion !== PRONUNCIATION_AUDIO_SCHEMA) {
    issues.push(`manifestVersion 必须是 ${PRONUNCIATION_AUDIO_SCHEMA}`);
  }
  const generatedAtText = requireString(generatedAt, 'generatedAt', issues);
  if (generatedAtText && !Number.isFinite(Date.parse(generatedAtText))) {
    issues.push('generatedAt 必须是有效时间');
  }
  if (!Array.isArray(assets)) {
    issues.push('assets 必须是数组');
    return issues;
  }
  const assetIds = new Set<string>();
  for (const [index, asset] of assets.entries()) {
    validateAsset(asset, `assets[${String(index)}]`, issues);
    if (isRecord(asset) && typeof asset['assetId'] === 'string') {
      if (assetIds.has(asset['assetId'])) issues.push(`assets[${String(index)}].assetId 重复`);
      assetIds.add(asset['assetId']);
    }
  }
  if (!Array.isArray(entries)) {
    issues.push('entries 必须是数组');
    return issues;
  }
  const entryKeys = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    validateEntry(entry, `entries[${String(index)}]`, assetIds, issues);
    if (isRecord(entry)) {
      const key = JSON.stringify([
        entry['word'],
        entry['phoneticFingerprint'],
        entry['accent'],
        entry['scope'],
        entry['assetId'],
      ]);
      if (entryKeys.has(key)) issues.push(`entries[${String(index)}] 重复`);
      entryKeys.add(key);
    }
  }
  return issues;
}

export function parsePronunciationAudioManifest(value: unknown): PronunciationAudioManifest {
  const issues = validatePronunciationAudioManifest(value);
  if (issues.length > 0) throw new Error(`发音音频 manifest 无效：\n${issues.join('\n')}`);
  return value as PronunciationAudioManifest;
}

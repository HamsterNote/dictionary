import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OFFLINE_DICTIONARY_PACKAGE_VERSION } from '../dist/offline-resources.js';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(
  await readFile(new URL('../resources/dictionary/manifest.json', import.meta.url), 'utf8'),
);
assert.equal(
  manifest.packageVersion,
  packageJson.version,
  'resource manifest version must match package.json',
);
assert.equal(
  OFFLINE_DICTIONARY_PACKAGE_VERSION,
  packageJson.version,
  'built runtime version must match package.json',
);
process.stdout.write(
  `Package, manifest and built offline runtime versions agree: ${packageJson.version}\n`,
);

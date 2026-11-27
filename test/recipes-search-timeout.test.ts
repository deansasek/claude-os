// The Recipes Discover search and pantry read give up on a PC that does not answer, and the error shows (src/apps/recipes/web/index.ts).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/recipes/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the search and pantry timeouts are defined, and the pantry one covers two PC calls', () => {
  assert.match(src, /const SEARCH_TIMEOUT_MS = 20e3;/);
  assert.match(src, /const PANTRY_TIMEOUT_MS = 35e3;/);
});

test('the Discover search and the pantry read pass their timeouts', () => {
  assert.match(src, /getJson<MealsResult>\(`\$\{API\}\/search\?q=\$\{encodeURIComponent\(query\)\}`, SEARCH_TIMEOUT_MS\)/);
  assert.match(src, /getJson<PantryResult>\(`\$\{API\}\/pantry\?have=\$\{encodeURIComponent\(have\.join\(','\)\)\}&want=\$\{encodeURIComponent\(want\.join\(','\)\)\}`, PANTRY_TIMEOUT_MS\)/);
});

test('both catches still show the PC-down text, so a timed-out read lands in the error state', () => {
  assert.match(src, /catch \{\s*if \(mine !== seq\) return;\s*results = \[\];\s*resultsState = 'error';\s*resultsError = PC_DOWN;/);
  assert.match(src, /catch \{\s*if \(mine !== foundSeq\) return;\s*found = \[\];\s*foundMissing = \[\];\s*foundState = 'error';\s*foundError = PC_DOWN;/);
});

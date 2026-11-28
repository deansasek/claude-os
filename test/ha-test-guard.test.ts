// A double tap on Test connection sends one test (src/apps/home-assistant/web/index.ts runTest). The page is DOM code,
// so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/home-assistant/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function runTest(): Promise<void> {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('runTest returns while a test is running, and clears the flag when it ends', () => {
  assert.ok(start > 0, 'runTest() exists');
  assert.match(src, /let testing = false;/);
  assert.match(body, /if \(testing\) return;\s*testing = true;/);
  assert.match(body, /finally \{\s*testing = false;\s*\}/);
});

test('the test post keeps its timeout', () => {
  assert.match(body, /postJson<HaTestResult>\(`\$\{API\}\/test`, \{\}, POST_TIMEOUT_MS\)/);
});

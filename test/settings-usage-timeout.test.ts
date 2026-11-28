// The Settings usage read off the tablet gives up on a PC that does not answer, and a late older read does not
// overwrite a newer one (src/apps/settings/web/index.ts loadUsage). The page is DOM code with no unit seam, so this reads
// its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadUsage(): Promise<void> {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the usage read has a timeout', () => {
  assert.ok(start > 0, 'loadUsage() exists');
  assert.match(src, /const USAGE_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<Usage>\('\/api\/claude\/usage', USAGE_TIMEOUT_MS\)/);
});

test('each PC read takes the next number, and both paths drop a read that is no longer the newest', () => {
  assert.match(body, /const seq = \+\+usageSeq;/);
  const guards = body.match(/if \(seq !== usageSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
});

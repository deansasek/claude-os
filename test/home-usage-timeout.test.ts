// The Home usage poll gives up on a usage read the PC never answers, and a late older read does not paint over a newer one
// (src/apps/home/web/index.ts loadUsage). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadUsage(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the usage read has a timeout shorter than the 30 s poll', () => {
  assert.ok(start > 0, 'loadUsage() exists');
  assert.match(src, /const USAGE_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<Usage>\('\/api\/claude\/usage', USAGE_TIMEOUT_MS\)/);
  assert.match(src, /pollT = window\.setInterval\(poll, 30e3\);/);
});

test('each read takes the next number, and only the newest read sets the usage', () => {
  assert.match(body, /const seq = \+\+usageSeq;/);
  const guards = body.match(/if \(seq !== usageSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(body.indexOf('if (seq !== usageSeq) return;') < body.indexOf('usage = u;'), 'the check comes before the usage is set');
});

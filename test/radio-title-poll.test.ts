// The Radio stream-title read gives up on a read the PC never answers, and an answer to an older read does not paint over a newer one
// (src/apps/radio/web/index.ts fetchTitle). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/radio/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function fetchTitle(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the title read has a timeout', () => {
  assert.ok(start > 0, 'fetchTitle() exists');
  assert.match(src, /const TITLE_TIMEOUT_MS = 8e3;/);
  assert.match(body, /getJson<TitleResult>\(`\$\{API\}\/title\?url=\$\{encodeURIComponent\(s\.url\)\}`, TITLE_TIMEOUT_MS\)/);
});

test('each read takes the next number before it waits', () => {
  const seq = body.indexOf('const seq = ++titleSeq;');
  const await_ = body.indexOf('await getJson<TitleResult>');
  assert.ok(seq > 0 && await_ > seq, 'the number is taken before the read');
});

test('both the answer and the failure path drop a read that is no longer the newest', () => {
  const guards = body.match(/seq !== titleSeq|seq === titleSeq/g) ?? [];
  assert.equal(guards.length, 2);
  const catchAt = body.indexOf('} catch {');
  assert.ok(body.indexOf('seq !== titleSeq') < catchAt, 'the success path checks the number');
  assert.ok(body.indexOf('seq === titleSeq', catchAt) > catchAt, 'the failure path checks the number');
});

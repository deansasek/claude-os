// A late older place or unit save does not change or undo a newer one (src/apps/weather/web/index.ts sendLocation).
// The page talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/weather/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function sendLocation(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('each save takes the next number, and a stale reply is dropped on both paths', () => {
  assert.ok(start > 0, 'sendLocation() exists');
  assert.match(src, /let saveSeq = 0;/);
  assert.match(body, /const seq = \+\+saveSeq;/);
  assert.match(body, /if \(seq !== saveSeq\) return null; throw err;/, 'a stale failure is not rethrown');
  assert.match(body, /if \(!d \|\| seq !== saveSeq\) return;/, 'a stale reply is not applied');
});

test('the stale check comes before the reply changes any state', () => {
  const guard = body.indexOf('if (!d || seq !== saveSeq) return;');
  assert.ok(guard > 0 && guard < body.indexOf('pcDown = false;'), 'the guard comes before pcDown is cleared');
  assert.ok(guard < body.indexOf('wx = d;'), 'the guard comes before the forecast is set');
});

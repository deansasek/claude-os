// A News feed load that answers after a newer load started is dropped, and gives back the topic change it took (src/apps/news/web/index.ts load).
// index.ts needs the browser to run, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/news/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function load(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('each load takes the next number', () => {
  assert.match(src, /let loadSeq = 0;/);
  assert.ok(start > 0, 'load() exists');
  assert.match(body, /const mine = \+\+loadSeq;/);
});

test('a load checks it is still the newest after each await, before it touches the screen', () => {
  const stale = body.indexOf('stale()');
  const stamp = body.indexOf('loadedAt = Date.now();');
  assert.ok(stale > 0 && stamp > stale, 'the check comes before loadedAt is set');
  const awaits = [...body.matchAll(/await /g)].map(m => m.index as number);
  for (const a of awaits) {
    assert.ok(body.indexOf('stale()', a) > a, `a check follows the await at offset ${a}`);
  }
});

test('a dropped load gives back the topic change it took', () => {
  assert.match(body, /if \(wasDirty\) topicsDirty = true;\s*return true;/);
});

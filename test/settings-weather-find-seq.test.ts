// A late older Settings weather city search does not open a stale chooser (src/apps/settings/web/index.ts findWeatherCity).
// The Settings page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/settings/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function findWeatherCity(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('each city search takes the next number, and a stale answer is dropped on both paths', () => {
  assert.ok(start > 0, 'findWeatherCity() exists');
  assert.match(src, /let wxFindSeq = 0;/);
  assert.match(body, /const seq = \+\+wxFindSeq;/);
  const guards = body.match(/if \(seq !== wxFindSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
});

test('the stale check comes before the chooser opens', () => {
  const guard = body.indexOf('if (seq !== wxFindSeq) return;');
  assert.ok(guard > 0 && guard < body.indexOf('openChooser('), 'the guard comes before the chooser opens');
});

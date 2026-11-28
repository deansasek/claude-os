// A late older Settings weather place save does not change the note, the forecast or the sheet (src/apps/settings/web/index.ts
// saveWeatherPlace). The Settings page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/settings/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function saveWeatherPlace(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('each place save takes the next number, and a stale reply is dropped on both paths', () => {
  assert.ok(start > 0, 'saveWeatherPlace() exists');
  assert.match(src, /let wxSaveSeq = 0;/);
  assert.match(body, /const seq = \+\+wxSaveSeq;/);
  const guards = body.match(/if \(seq !== wxSaveSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
});

test('the stale check comes before the forecast read is cancelled', () => {
  const guard = body.indexOf('if (seq !== wxSaveSeq) return;');
  assert.ok(guard > 0 && guard < body.indexOf('wxSeq++;'), 'the guard comes before wxSeq is bumped');
});

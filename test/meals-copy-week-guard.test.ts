// Copy last week copies only onto the week it started for (src/apps/meals/web/index.ts copyLastWeek). The page is DOM code,
// so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the copy remembers its week, and stops before writing when the week has changed during the read', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('async function copyLastWeek(c: AppContext)');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /const week = days;/);
  const read = body.indexOf('await getJson<LocalRead>');
  const check = body.indexOf('if (days !== week) { setStatus(c, \'\'); return; }');
  const write = body.indexOf('local-add');
  assert.ok(check > read && write > check, 'the week check comes after the read and before any write');
});

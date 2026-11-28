// Calendar reads the range on screen again when the view moved during a read (src/apps/calendar/web/index.ts load). The page is
// DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('a read remembers its range, and reads again when the view has moved on', () => {
  const src = readFileSync(new URL('../src/apps/calendar/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('async function load(force = false, auto = false)');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /const asked = rangeKey\(rangeFor\(\)\);/);
  assert.match(body, /if \(rangeKey\(rangeFor\(\)\) !== asked\) void load\(\);/);
});

// A spoken alarm does not take over a reminder Claude set for the same time (src/apps/clock/web/index.ts addAlarm). The page is DOM
// code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/clock/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  addAlarm(h: number, m: number, days: number[], tomorrow = false)');
const body = src.slice(start, src.indexOf('\n  },', start));

test('addAlarm reuses only the user’s own unlabelled alarm at that time', () => {
  assert.ok(start > 0, 'addAlarm exists');
  assert.match(body, /alarms\.find\(x => x\.h === h && x\.m === m && !x\.claude && !labelOf\(x\)\)/);
});

test('a reminder Claude set keeps its days when a spoken alarm is added at the same time', () => {
  // a new alarm is added instead of rewriting the reminder's days
  assert.match(body, /if \(!a\) \{[\s\S]*alarms\.push\(a\);/);
});

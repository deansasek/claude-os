// The short wording for a timer or alarm (src/apps/clock/web/timer-text.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { whenWord, words } from '../src/apps/clock/web/timer-text.ts';

test('seconds read as seconds until they round up to a minute, then as minutes', () => {
  assert.equal(words(0), '1s');
  assert.equal(words(45_000), '45s');
  assert.equal(words(59_400), '59s');
  assert.equal(words(59_700), '1m');
  assert.equal(words(60_000), '1m');
});

test('whenWord says today, tomorrow, a plain weekday, then next weekday from 7 days', () => {
  const now = new Date(2026, 10, 26, 9);   // Thursday 26 Nov 2026, 09:00
  assert.equal(whenWord(new Date(2026, 10, 26, 18).getTime(), now), 'today');
  assert.equal(whenWord(new Date(2026, 10, 27, 7).getTime(), now), 'tomorrow');
  assert.equal(whenWord(new Date(2026, 10, 29, 7).getTime(), now), 'Sunday');
  assert.equal(whenWord(new Date(2026, 11, 3, 7).getTime(), now), 'next Thursday');
});

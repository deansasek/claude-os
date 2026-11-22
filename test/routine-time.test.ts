// A routine's time of day and days: checked on save, and kept when the routine is cleaned. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanRoutine, cleanTime } from '../src/apps/routines/api.ts';

test('no time means the routine does not run by itself', () => {
  assert.equal(cleanTime(undefined), null);
  assert.equal(cleanTime(null), null);
});

test('a time and days are kept, with the days in order and no repeats', () => {
  assert.deepEqual(cleanTime({ h: 7, m: 5, days: [5, 1, 1, 0] }), { h: 7, m: 5, days: [0, 1, 5] });
  assert.deepEqual(cleanTime({ h: 0, m: 0 }), { h: 0, m: 0, days: [] });
});

test('a time outside the clock, or a day outside the week, is refused', () => {
  assert.ok('error' in (cleanTime({ h: 24, m: 0, days: [] }) as object));
  assert.ok('error' in (cleanTime({ h: 7, m: 60, days: [] }) as object));
  assert.ok('error' in (cleanTime({ h: 7.5, m: 0, days: [] }) as object));
  assert.ok('error' in (cleanTime({ h: 7, m: 0, days: [7] }) as object));
  assert.ok('error' in (cleanTime('7:00') as object));
});

test('a routine keeps its time through cleaning, and a bad time refuses the routine', () => {
  const good = cleanRoutine({ name: 'Morning', phrases: ['morning'], steps: [{ kind: 'weather' }], at: { h: 7, m: 0, days: [1, 2, 3, 4, 5] } });
  assert.ok(!('error' in good));
  if (!('error' in good)) assert.deepEqual(good.at, { h: 7, m: 0, days: [1, 2, 3, 4, 5] });

  const none = cleanRoutine({ name: 'Plain', phrases: ['plain'], steps: [{ kind: 'weather' }] });
  assert.ok(!('error' in none));
  if (!('error' in none)) assert.equal(none.at, undefined);

  const bad = cleanRoutine({ name: 'Broken', phrases: ['broken'], steps: [{ kind: 'weather' }], at: { h: 99, m: 0, days: [] } });
  assert.ok('error' in bad);
});

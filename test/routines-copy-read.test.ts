// The saved copy of the Routines list keeps only whole routines (src/apps/routines/web/local.ts keepRoutines). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepRoutines } from '../src/apps/routines/web/local.ts';

const good = { id: 'r1', name: 'Morning', phrases: ['good morning'], steps: [], at: { h: 7, m: 0, days: [1, 2, 3] } };

test('a value that is not a list of routines gives no list', () => {
  assert.deepEqual(keepRoutines(null), { routines: null, dropped: false });
  assert.deepEqual(keepRoutines('x'), { routines: null, dropped: false });
});

test('entries that are not whole routines are left out, and the copy is marked as dropped', () => {
  const broken = { ...good, id: 'r2', at: { h: 7, m: 0 } };   // a time with no days
  const r = keepRoutines([null, 42, { id: 'a' }, broken, good]);
  assert.deepEqual(r.routines, [good]);
  assert.equal(r.dropped, true);
});

test('a routine with no time is kept', () => {
  const noTime = { id: 'r3', name: 'Bedtime', phrases: [], steps: [] };
  assert.deepEqual(keepRoutines([noTime]).routines, [noTime]);
});

test('a list of whole routines is not marked as dropped', () => {
  assert.deepEqual(keepRoutines([good]), { routines: [good], dropped: false });
});

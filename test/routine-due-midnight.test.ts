// A routine's start window runs past midnight, and it is judged on the day it was due (src/apps/routines/api.ts dueDay). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayKey, dueDay, dueRoutines, type Routine } from '../src/apps/routines/api.ts';

const late: Routine = { id: 'late', name: 'Late', phrases: ['late'], steps: [], at: { h: 23, m: 30, days: [] } };
const friday: Routine = { id: 'fri', name: 'Friday', phrases: ['friday'], steps: [], at: { h: 23, m: 45, days: [5] } };

test('a 23:30 daily routine is still due at 00:10 the next day, and runs once for the day it was due', () => {
  const at0010 = new Date(2026, 10, 28, 0, 10);
  assert.equal(dueDay(late, at0010, {}), dayKey(new Date(2026, 10, 27)));
  assert.equal(dueRoutines([late], at0010, {}).length, 1);
  assert.equal(dueRoutines([late], at0010, { late: dayKey(new Date(2026, 10, 27)) }).length, 0);
});

test('a Friday-only 23:45 routine is still due at 00:05 on Saturday, judged as Friday', () => {
  const satMorning = new Date(2026, 10, 28, 0, 5);   // 28 November 2026 is a Saturday
  assert.equal(dueDay(friday, satMorning, {}), dayKey(new Date(2026, 10, 27)));
});

test('a routine is not due an hour after its window closes', () => {
  assert.equal(dueRoutines([late], new Date(2026, 10, 28, 0, 40), {}).length, 0);
});

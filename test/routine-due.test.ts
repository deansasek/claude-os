// Which routines are due: at their time, on their days, once a day, within the window. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayKey, dueRoutines, type Routine } from '../src/apps/routines/api.ts';

const at = (h: number, m: number, days: number[] = []): Routine =>
  ({ id: 'wake', name: 'Wake', phrases: ['wake'], steps: [{ kind: 'weather' }], at: { h, m, days } });

// 2026-11-22 is a Sunday (day 0).
const sunday = (h: number, m: number) => new Date(2026, 10, 22, h, m, 0);

test('a routine is due at its time and for the next hour', () => {
  const list = [at(7, 0)];
  assert.equal(dueRoutines(list, sunday(7, 0), {}).length, 1);
  assert.equal(dueRoutines(list, sunday(7, 59), {}).length, 1);
  assert.equal(dueRoutines(list, sunday(8, 0), {}).length, 0);
  assert.equal(dueRoutines(list, sunday(6, 59), {}).length, 0);
});

test('a routine that already ran today is not due again', () => {
  const list = [at(7, 0)];
  assert.equal(dueRoutines(list, sunday(7, 10), { wake: dayKey(sunday(7, 0)) }).length, 0);
  assert.equal(dueRoutines(list, sunday(7, 10), { wake: '2026-11-21' }).length, 1);   // ran yesterday only
});

test('the days are respected: no days means every day', () => {
  assert.equal(dueRoutines([at(7, 0, [1, 2, 3, 4, 5])], sunday(7, 0), {}).length, 0);   // Sunday is not a weekday
  assert.equal(dueRoutines([at(7, 0, [0])], sunday(7, 0), {}).length, 1);
  assert.equal(dueRoutines([at(7, 0)], sunday(7, 0), {}).length, 1);
});

test('a routine with no time is never due', () => {
  const plain: Routine = { id: 'plain', name: 'Plain', phrases: ['plain'], steps: [{ kind: 'weather' }] };
  assert.equal(dueRoutines([plain], sunday(7, 0), {}).length, 0);
});

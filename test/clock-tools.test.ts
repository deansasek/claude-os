// The tablet tool checks for the Clock: status and cancels take no arguments. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check } from '../src/apps/claude/server/tablet.ts';

test('the Clock status and cancel operations need no arguments', () => {
  for (const op of ['clock_status', 'cancel_timer', 'cancel_alarms'] as const) {
    const c = check(op, {});
    assert.equal(c.ok, true, op);
    if (c.ok) assert.deepEqual(c.args, {});
  }
});

test('an alarm or reminder can repeat on days: sorted, unique, and within the week', () => {
  const c = check('alarm', { time: '07:00', days: [5, 1, 1] });
  assert.equal(c.ok, true);
  if (c.ok) assert.deepEqual((c.args as { days: number[] }).days, [1, 5]);
  const once = check('alarm', { time: '07:00' });
  if (once.ok) assert.deepEqual((once.args as { days: number[] }).days, []);
  assert.equal(check('alarm', { time: '07:00', days: [7] }).ok, false);
  assert.equal(check('reminder', { time: '08:00', text: 'Bins', days: ['tue'] }).ok, false);
});

test('the timer and alarm checks still refuse bad input', () => {
  assert.equal(check('timer', { minutes: 0 }).ok, false);
  assert.equal(check('alarm', { time: '25:00' }).ok, false);
  assert.equal(check('reminder', { time: '08:00', text: '' }).ok, false);
});

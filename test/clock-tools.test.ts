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

test('the timer and alarm checks still refuse bad input', () => {
  assert.equal(check('timer', { minutes: 0 }).ok, false);
  assert.equal(check('alarm', { time: '25:00' }).ok, false);
  assert.equal(check('reminder', { time: '08:00', text: '' }).ok, false);
});

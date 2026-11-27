// The lock screen glance line (src/core/web/lock-glance.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glanceDelay, glanceLine } from '../src/core/web/lock-glance.ts';

test('glanceLine shows counts and times only, joined by a dot', () => {
  assert.equal(glanceLine(3, 'Alarm 7:00 AM', '4:59'), '3 notifications · Alarm 7:00 AM · Timer 4:59');
  assert.equal(glanceLine(1, null, null), '1 notification');
  assert.equal(glanceLine(0, 'Alarm 7:00 AM', null), 'Alarm 7:00 AM');
  assert.equal(glanceLine(0, null, '1:04:59'), 'Timer 1:04:59');
});

test('glanceLine is empty when there is nothing to show', () => {
  assert.equal(glanceLine(0, null, null), '');
  assert.equal(glanceLine(-2, null, null), '');
});

test('glanceDelay repaints each second while a timer runs', () => {
  assert.equal(glanceDelay(60_000 * 5 + 10_000, true), 1050);
  assert.equal(glanceDelay(60_000 * 5 + 10_250, true), 800);
  assert.ok(glanceDelay(12_345, true) <= 1000);
});

test('glanceDelay repaints each minute when no timer runs', () => {
  assert.equal(glanceDelay(60_000 * 5 + 10_000, false), 50_050);
  assert.equal(glanceDelay(60_000 * 5, false), 60_050);
});

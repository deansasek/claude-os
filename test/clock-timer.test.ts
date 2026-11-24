// The running Clock timer as the other screens read it (src/core/web/clock-timer.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockTimerLeftMs, clockTimerText } from '../src/core/web/clock-timer.ts';

const NOW = 1_000_000;
const timer = (end: number | null) => JSON.stringify({ dur: 300_000, end, left: null });

test('no timer, a paused timer or unreadable text gives no time left', () => {
  assert.equal(clockTimerLeftMs(null, NOW), null);
  assert.equal(clockTimerLeftMs(timer(null), NOW), null);
  assert.equal(clockTimerLeftMs('not json', NOW), null);
  assert.equal(clockTimerText(timer(null), NOW), null);
});

test('a running timer gives its time left in ms', () => {
  assert.equal(clockTimerLeftMs(timer(NOW + 299_000), NOW), 299_000);
  assert.equal(clockTimerLeftMs(timer(NOW), NOW), null);          // ends now: not running any more
  assert.equal(clockTimerLeftMs(timer(NOW - 5_000), NOW), null);  // already past its end
});

test('the countdown text rounds up to the second and shows hours from an hour up', () => {
  assert.equal(clockTimerText(timer(NOW + 299_001), NOW), '5:00');
  assert.equal(clockTimerText(timer(NOW + 59_000), NOW), '0:59');
  assert.equal(clockTimerText(timer(NOW + 3_899_000), NOW), '1:04:59');
});

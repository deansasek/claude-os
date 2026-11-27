// The calendar's swipe: a clear sideways move changes the period, and a scroll or a short move does not. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { swipeStep } from '../src/apps/calendar/web/swipe.ts';

test('a left swipe is the next period, and a right swipe the previous', () => {
  assert.equal(swipeStep(-120, 4), 1);
  assert.equal(swipeStep(120, -6), -1);
});

test('a short move, or a mostly vertical one (a scroll), changes nothing', () => {
  assert.equal(swipeStep(-40, 0), 0, 'under 60px is not a swipe');
  assert.equal(swipeStep(-100, 90), 0, 'a diagonal move that is not clearly sideways');
  assert.equal(swipeStep(0, 300), 0, 'a scroll');
});

test('the ratio is 1.5 times the vertical move, as in the Photos viewer', () => {
  assert.equal(swipeStep(-100, 60), 1, '100 is more than 1.5 times 60');
  assert.equal(swipeStep(-100, 70), 0, '100 is not more than 1.5 times 70');
});

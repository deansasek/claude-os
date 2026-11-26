// Saved Quiet hours that are not the right shape fall back field by field, so the status line and the DND tile never break. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuiet } from '../src/core/web/quiet-hours.ts';

test('no saved value, null, an array and a string all give the defaults', () => {
  const def = { on: false, days: [1, 2, 3, 4, 5, 6, 0], from: '22:00', to: '07:00', pauseWake: true };
  assert.deepEqual(parseQuiet(null), def);
  assert.deepEqual(parseQuiet('null'), def);
  assert.deepEqual(parseQuiet('[1]'), def);
  assert.deepEqual(parseQuiet('"x"'), def);
});

test('a time that is not H:MM falls back to the default, a valid one is kept', () => {
  const q = parseQuiet(JSON.stringify({ from: 23, to: 'soon' }));
  assert.equal(q.from, '22:00');
  assert.equal(q.to, '07:00');
  assert.equal(parseQuiet(JSON.stringify({ from: '21:30', to: '6:15' })).from, '21:30');
});

test('days keep only whole numbers 0 to 6, and an empty list means every day', () => {
  assert.deepEqual(parseQuiet(JSON.stringify({ days: [1, 'x', 9, 1.5, 3] })).days, [1, 3]);
  assert.deepEqual(parseQuiet(JSON.stringify({ days: ['mon'] })).days, [1, 2, 3, 4, 5, 6, 0]);
});

test('on and pauseWake read as booleans', () => {
  assert.equal(parseQuiet(JSON.stringify({ on: 'yes' })).on, false);
  assert.equal(parseQuiet(JSON.stringify({ on: true, pauseWake: false })).pauseWake, false);
});

// The Dice rolls and the coin (src/apps/dice/web/roll.ts). The random source is passed in, so each result is exact.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flipCoin, rollDice, total } from '../src/apps/dice/web/roll.ts';

test('each die shows a face from 1 to 6', () => {
  assert.deepEqual(rollDice(3, () => 0), [1, 1, 1]);
  assert.deepEqual(rollDice(2, () => 0.999), [6, 6]);
  assert.deepEqual(rollDice(1, () => 0.5), [4]);
});

test('the dice count is kept between one and six', () => {
  assert.equal(rollDice(0, () => 0).length, 1);
  assert.equal(rollDice(9, () => 0).length, 6);
  assert.equal(rollDice(2.7, () => 0).length, 2);
});

test('the coin shows heads below one half, and tails at or above it', () => {
  assert.equal(flipCoin(() => 0.2), 'Heads');
  assert.equal(flipCoin(() => 0.5), 'Tails');
});

test('the total adds the faces', () => {
  assert.equal(total([3, 4, 6]), 13);
  assert.equal(total([]), 0);
});

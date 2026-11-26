// The short wording for a timer or alarm (src/apps/clock/web/timer-text.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { words } from '../src/apps/clock/web/timer-text.ts';

test('seconds read as seconds until they round up to a minute, then as minutes', () => {
  assert.equal(words(0), '1s');
  assert.equal(words(45_000), '45s');
  assert.equal(words(59_400), '59s');
  assert.equal(words(59_700), '1m');
  assert.equal(words(60_000), '1m');
});

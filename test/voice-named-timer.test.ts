// A named timer said with the label first (src/core/web/voice-parse.ts labelledTimer, used by voice-commands.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelledTimer } from '../src/core/web/voice-parse.ts';

test('the label can come before the duration', () => {
  assert.deepEqual(labelledTimer('set a pasta timer for 10 minutes'), { ms: 10 * 60e3, label: 'pasta' });
  assert.deepEqual(labelledTimer('start the rice timer of 20 minutes'), { ms: 20 * 60e3, label: 'rice' });
});

test('the duration can come before the label, after for', () => {
  assert.deepEqual(labelledTimer('set a 10 minute timer for the pasta'), { ms: 10 * 60e3, label: 'pasta' });
});

test('a plain duration timer is not a named one here, and a phrase with no duration is not a timer', () => {
  assert.equal(labelledTimer('set a timer for 10 minutes'), null);   // the timer patterns take it, with no label
  assert.equal(labelledTimer('set a pasta timer for later'), null);
  assert.equal(labelledTimer('what is for dinner'), null);
});

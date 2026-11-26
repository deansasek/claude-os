// The wait text after too many wrong PINs on the Claude pad: seconds, with the right singular and plural.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOCK_DEFAULT_SECS, pinMessage, waitText } from '../src/apps/claude/web/sessions/pin-wait.ts';

test('the wait is in seconds, as the PC sends it', () => {
  assert.equal(waitText(30), 'Too many tries. Wait 30 seconds.');
  assert.equal(waitText(12.2), 'Too many tries. Wait 13 seconds.');
});

test('one second is singular, and a missing wait uses the PC lockout', () => {
  assert.equal(waitText(1), 'Too many tries. Wait 1 second.');
  assert.equal(waitText(0), 'Too many tries. Wait 1 second.');
  assert.equal(waitText(LOCK_DEFAULT_SECS), 'Too many tries. Wait 30 seconds.');
});

test('no answer from the PC says it cannot be reached', () => {
  assert.equal(pinMessage(null), 'Can’t reach your PC just now. Try again.');
});

test('locked, no_pin and wrong-PIN results keep their wording', () => {
  assert.equal(pinMessage({ ok: false, error: 'locked', retryIn: 12.2 }), 'Too many tries. Wait 13 seconds.');
  assert.equal(pinMessage({ ok: false, error: 'locked' }), 'Too many tries. Wait 30 seconds.');
  assert.equal(pinMessage({ ok: false, error: 'no_pin' }), 'No PIN is set on the PC yet.');
  assert.equal(pinMessage({ ok: false, error: 'wrong_pin' }), 'That’s not it. Try again.');
  assert.equal(pinMessage({ ok: false }), 'That’s not it. Try again.');
});

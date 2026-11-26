// The wait text after too many wrong PINs on the Claude pad: seconds, with the right singular and plural.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOCK_DEFAULT_SECS, waitText } from '../src/apps/claude/web/sessions/pin-wait.ts';

test('the wait is in seconds, as the PC sends it', () => {
  assert.equal(waitText(30), 'Too many tries. Wait 30 seconds.');
  assert.equal(waitText(12.2), 'Too many tries. Wait 13 seconds.');
});

test('one second is singular, and a missing wait uses the PC lockout', () => {
  assert.equal(waitText(1), 'Too many tries. Wait 1 second.');
  assert.equal(waitText(0), 'Too many tries. Wait 1 second.');
  assert.equal(waitText(LOCK_DEFAULT_SECS), 'Too many tries. Wait 30 seconds.');
});

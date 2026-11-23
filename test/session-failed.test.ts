// The one sentence for a failed reply (src/apps/claude/web/failed.ts), shared by the tablet chat and the PC hub. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failedSentence } from '../src/apps/claude/web/failed.ts';

test('an assistant error code gives its own sentence', () => {
  assert.equal(failedSentence('authentication_failed'), 'Sign in again under Settings → Apps → Claude.');
  assert.equal(failedSentence('rate_limit'), 'Claude hit a limit. Wait a while, then try again.');
  assert.equal(failedSentence('overloaded'), 'Claude is busy right now. Try again in a minute.');
  assert.equal(failedSentence('model_not_found'), 'That model isn’t available. Pick another model and try again.');
});

test('a result subtype gives its own sentence: out of steps, or a chat too long to read', () => {
  assert.equal(failedSentence('error_max_turns'), 'Claude ran out of steps before it finished. Ask it to carry on.');
  assert.equal(failedSentence('prompt_too_long'), 'This chat is too long for Claude to read. Start a new chat.');
});

test('an unknown or missing reason gives the general sentence', () => {
  assert.equal(failedSentence('error_during_execution'), 'That reply didn’t finish. Try again.');
  assert.equal(failedSentence(null), 'That reply didn’t finish. Try again.');
  assert.equal(failedSentence(undefined), 'That reply didn’t finish. Try again.');
});

test('every sentence is one short line', () => {
  for (const r of ['authentication_failed', 'billing_error', 'rate_limit', 'overloaded', 'model_not_found', 'invalid_request', 'max_output_tokens', 'server_error', 'error_max_turns', 'prompt_too_long']) {
    const s = failedSentence(r);
    assert.ok(s.length <= 90 && !s.includes('\n'), `${r}: ${s}`);
  }
});

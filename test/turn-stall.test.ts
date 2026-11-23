// The PC-or-Hub stalled line for a Hub turn (src/apps/claude/server/turns.ts progressFor): the pure part.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { progressFor } from '../src/apps/claude/server/turns.ts';
import { STALLED_TEXT, STALL_MS } from '../src/apps/claude/web/native-stream.ts';

const T0 = 1_000_000;

test('a running Hub turn shows the stalled line after STALL_MS with no new step', () => {
  assert.deepEqual(progressFor(['Reading a file'], 'running', false, T0, T0 + STALL_MS - 1), ['Reading a file']);
  assert.deepEqual(progressFor(['Reading a file'], 'running', false, T0, T0 + STALL_MS), ['Reading a file', STALLED_TEXT]);
  assert.deepEqual(progressFor([], 'running', false, T0, T0 + STALL_MS), [STALLED_TEXT]);
});

test('a turn waiting for an OK, a finished turn, or a turn with no event time shows no stalled line', () => {
  assert.deepEqual(progressFor(['Asking: rm'], 'approval', false, T0, T0 + STALL_MS * 2), ['Asking: rm']);
  assert.deepEqual(progressFor(['Finished'], 'done', false, T0, T0 + STALL_MS * 2), ['Finished']);
  assert.deepEqual(progressFor(['Stopped'], 'stopped', false, T0, T0 + STALL_MS * 2), ['Stopped']);
  assert.deepEqual(progressFor(['Sent'], 'running', false, undefined, T0 + STALL_MS * 2), ['Sent']);
});

test('a turn that runs on the PC never shows the stalled line', () => {
  assert.deepEqual(progressFor(['Sent to your PC session'], 'running', true, T0, T0 + STALL_MS * 5), ['Sent to your PC session']);
});

test('only the latest six steps are shown, and the stalled line comes after them', () => {
  const steps = ['1', '2', '3', '4', '5', '6', '7', '8'];
  assert.deepEqual(progressFor(steps, 'running', false, T0, T0 + STALL_MS), ['3', '4', '5', '6', '7', '8', STALLED_TEXT]);
  assert.deepEqual(progressFor(steps, 'running', false, T0, T0 + 1), ['3', '4', '5', '6', '7', '8']);
});

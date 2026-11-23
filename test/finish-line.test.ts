// The last step of a Hub turn (src/apps/claude/server/turns.ts finishLine): the turn time when it is done.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishLine } from '../src/apps/claude/server/turns.ts';

test('a done turn shows its time, in seconds or minutes', () => {
  assert.equal(finishLine('done', 8_000), 'Finished in 8 s');
  assert.equal(finishLine('done', 125_000), 'Finished in 2 min 5 s');
});

test('a done turn with no time from the SDK shows plain Finished', () => {
  assert.equal(finishLine('done', null), 'Finished');
});

test('a stopped or failed turn shows no time', () => {
  assert.equal(finishLine('stopped', 8_000), 'Stopped');
  assert.equal(finishLine('error', 8_000), 'Failed');
  assert.equal(finishLine('running', null), 'Failed');
});

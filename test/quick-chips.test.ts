// Quick replies picked from Claude's last message (src/apps/claude/web/sessions/quick-chips.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quickChips, retryChip } from '../src/apps/claude/web/sessions/quick-chips.ts';

const labels = (last: string) => quickChips(last).map(([label]) => label);

test('a question gets answers to that question', () => {
  assert.deepEqual(labels('Want me to restart the hub?'), ['Yes', 'No', 'Tell me more']);
  assert.deepEqual(labels('Shall I delete the old branch?  '), ['Yes', 'No', 'Tell me more']);
  assert.deepEqual(labels('Use the 2 PM slot or the 4 PM slot ("later")?'), ['Yes', 'No', 'Tell me more']);
});

test('a statement that mentions asking is not a question', () => {
  assert.deepEqual(labels('I should restart the hub, then run the tests.'), ['Continue', 'Looks good, thanks', 'Stop here']);
  assert.deepEqual(labels('Ok to proceed once the tests pass.'), ['Continue', 'Looks good, thanks', 'Stop here']);
});

test('no message gets chips for moving on', () => {
  assert.deepEqual(labels(''), ['Continue', 'Looks good, thanks', 'Stop here']);
});

test('after a failed or stopped reply, Try again resends the last message', () => {
  assert.deepEqual(retryChip('Fix the login bug  '), ['Try again', 'Fix the login bug']);
  assert.equal(retryChip(null), null);
  assert.equal(retryChip('   '), null);
});

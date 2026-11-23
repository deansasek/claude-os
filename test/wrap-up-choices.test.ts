// Next-step choices from Claude's wrap_up call (src/apps/claude/web/sessions/next-step.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionChoice, currentChoices, wrapUpChoices } from '../src/apps/claude/web/sessions/next-step.ts';

test('app actions map to a label and a reply', () => {
  assert.deepEqual(actionChoice('commit'), ['Commit', 'Commit the changes.']);
  assert.deepEqual(actionChoice('create_pr'), ['Create PR', 'Open a pull request for this.']);
  assert.deepEqual(actionChoice('merge'), ['Merge', 'Merge it.']);
  assert.deepEqual(actionChoice('fix_ci'), ['Fix CI', 'Fix the failing checks.']);
  assert.deepEqual(actionChoice('address_comments'), ['Address comments', 'Address the review comments.']);
  assert.deepEqual(actionChoice('resolve_conflicts'), ['Resolve conflicts', 'Resolve the merge conflicts.']);
  assert.deepEqual(actionChoice('verify'), ['Verify', 'Verify it.']);
  assert.deepEqual(actionChoice('archive'), ['Archive', 'Archive this session.']);
  assert.deepEqual(actionChoice('new_session'), ['New session', 'Start that as a new session.']);
});

test('an unknown app action reads as its words', () => {
  assert.deepEqual(actionChoice('run_tests'), ['Run tests', 'Run tests.']);
});

test('a reply button sends its label', () => {
  const step = wrapUpChoices({ ask: 'Which fix first?', recap: 'r', actions: [{ label: 'Fix 1' }, { action: 'commit' }] });
  assert.deepEqual(step, { ask: 'Which fix first?', choices: [['Fix 1', 'Fix 1'], ['Commit', 'Commit the changes.']] });
});

test('a wrap_up with no buttons gives no choices', () => {
  assert.equal(wrapUpChoices({ recap: 'Done.' }), null);
  assert.equal(wrapUpChoices({ recap: 'Done.', actions: [] }), null);
});

test('choices show only when no user message came after the wrap_up', () => {
  const wrap = { kind: 'wrap_up' as const, input: { ask: 'Commit?', actions: [{ action: 'commit' }] } };
  assert.deepEqual(currentChoices([{ kind: 'user' }, wrap])?.choices, [['Commit', 'Commit the changes.']]);
  assert.equal(currentChoices([wrap, { kind: 'user' }]), null);
  assert.equal(currentChoices([]), null);
});

test('the latest wrap_up wins, even with no buttons', () => {
  const old = { kind: 'wrap_up' as const, input: { actions: [{ action: 'merge' }] } };
  const latest = { kind: 'wrap_up' as const, input: { actions: [{ label: 'Yes' }] } };
  assert.deepEqual(currentChoices([old, { kind: 'user' }, latest])?.choices, [['Yes', 'Yes']]);
  assert.equal(currentChoices([old, { kind: 'wrap_up', input: { recap: 'Done.' } }]), null);
});

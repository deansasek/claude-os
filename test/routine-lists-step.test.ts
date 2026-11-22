// The routine step that reads a list aloud: checked when it is saved, and labelled. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEP_KINDS, cleanStep, stepLabel } from '../src/apps/routines/api.ts';

test('a lists step keeps Shopping or To-do, and refuses any other list', () => {
  assert.deepEqual(cleanStep({ kind: 'lists', list: 'shopping' }), { kind: 'lists', list: 'shopping' });
  assert.deepEqual(cleanStep({ kind: 'lists', list: 'todo' }), { kind: 'lists', list: 'todo' });
  assert.ok('error' in cleanStep({ kind: 'lists', list: 'garden' }));
  assert.ok('error' in cleanStep({ kind: 'lists' }));
});

test('the lists step is one of the step kinds and has a plain label', () => {
  assert.ok(STEP_KINDS.includes('lists'));
  assert.equal(stepLabel({ kind: 'lists', list: 'shopping' }), 'Read the shopping list');
  assert.equal(stepLabel({ kind: 'lists', list: 'todo' }), 'Read the to-do list');
});

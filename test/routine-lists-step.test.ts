// The routine step that reads a list aloud: checked when it is saved, and labelled. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEP_KINDS, cleanStep, stepLabel } from '../src/apps/routines/api.ts';

test('a lists step keeps a list id: Shopping, To-do, or one the family made', () => {
  assert.deepEqual(cleanStep({ kind: 'lists', list: 'shopping' }), { kind: 'lists', list: 'shopping' });
  assert.deepEqual(cleanStep({ kind: 'lists', list: 'todo' }), { kind: 'lists', list: 'todo' });
  assert.deepEqual(cleanStep({ kind: 'lists', list: 'garden-party' }), { kind: 'lists', list: 'garden-party' });
  assert.ok('error' in cleanStep({ kind: 'lists', list: 'Garden Party' }));   // not an id
  assert.ok('error' in cleanStep({ kind: 'lists', list: '../secrets' }));
  assert.ok('error' in cleanStep({ kind: 'lists' }));
});

test('the lists step is one of the step kinds and has a plain label', () => {
  assert.ok(STEP_KINDS.includes('lists'));
  assert.equal(stepLabel({ kind: 'lists', list: 'shopping' }), 'Read the shopping list');
  assert.equal(stepLabel({ kind: 'lists', list: 'todo' }), 'Read the to-do list');
  assert.equal(stepLabel({ kind: 'lists', list: 'garden-party' }), 'Read the garden party list');
});

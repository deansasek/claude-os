// The routine step that turns on a focus mode: checked when it is saved, and labelled. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEP_KINDS, cleanStep, stepLabel } from '../src/apps/routines/api.ts';

test('a focus step keeps one of the three modes: Work, Family or Sleep', () => {
  assert.deepEqual(cleanStep({ kind: 'focus', mode: 'work' }), { kind: 'focus', mode: 'work' });
  assert.deepEqual(cleanStep({ kind: 'focus', mode: 'family' }), { kind: 'focus', mode: 'family' });
  assert.deepEqual(cleanStep({ kind: 'focus', mode: 'sleep' }), { kind: 'focus', mode: 'sleep' });
  assert.ok('error' in cleanStep({ kind: 'focus', mode: 'gaming' }));
  assert.ok('error' in cleanStep({ kind: 'focus', mode: 'constructor' }));   // not a mode, even though a prototype has the name
  assert.ok('error' in cleanStep({ kind: 'focus' }));
});

test('the focus step is a known kind and reads as a line', () => {
  assert.ok(STEP_KINDS.includes('focus'));
  assert.equal(stepLabel({ kind: 'focus', mode: 'family' }), 'Turn on Family focus');
  assert.equal(stepLabel({ kind: 'focus', mode: 'sleep' }), 'Turn on Sleep focus');
});

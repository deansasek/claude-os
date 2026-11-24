// The routine step that plays the last radio station: checked when it is saved, and labelled. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEP_KINDS, cleanStep, stepLabel } from '../src/apps/routines/api.ts';

test('a radio step needs no fields and is a known kind', () => {
  assert.deepEqual(cleanStep({ kind: 'radio' }), { kind: 'radio' });
  assert.ok(STEP_KINDS.includes('radio'));
  assert.equal(stepLabel({ kind: 'radio' }), 'Play the last radio station');
});

// The bedtime steps: Do Not Disturb on or off, and the screen saver. Checked on save and labelled. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanStep, stepLabel } from '../src/apps/routines/api.ts';

test('a Do Not Disturb step keeps on or off, and refuses anything else', () => {
  assert.deepEqual(cleanStep({ kind: 'quiet', on: true }), { kind: 'quiet', on: true });
  assert.deepEqual(cleanStep({ kind: 'quiet', on: false }), { kind: 'quiet', on: false });
  assert.ok('error' in cleanStep({ kind: 'quiet' }));
  assert.ok('error' in cleanStep({ kind: 'quiet', on: 'yes' }));
});

test('the screen saver step is kept and has a plain label', () => {
  assert.deepEqual(cleanStep({ kind: 'ambient' }), { kind: 'ambient' });
  assert.equal(stepLabel({ kind: 'quiet', on: true }), 'Turn Do Not Disturb on');
  assert.equal(stepLabel({ kind: 'quiet', on: false }), 'Turn Do Not Disturb off');
  assert.equal(stepLabel({ kind: 'ambient' }), 'Show the screen saver');
});

// A Do Not Disturb routine step can be turned on or off on the tablet (src/apps/routines/web/index.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { stepLabel } from '../src/apps/routines/api.ts';

const src = readFileSync(new URL('../src/apps/routines/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the step words say on or off', () => {
  assert.equal(stepLabel({ kind: 'quiet', on: true }), 'Turn Do Not Disturb on');
  assert.equal(stepLabel({ kind: 'quiet', on: false }), 'Turn Do Not Disturb off');
});

test('a Do Not Disturb step is editable like a Say or Scene step', () => {
  assert.match(src, /if \(s\.kind === 'say' \|\| s\.kind === 'scene' \|\| s\.kind === 'quiet'\) \{/);
});

test('a tap on a Do Not Disturb step flips it and repaints', () => {
  assert.match(src, /else if \(s\.kind === 'quiet'\) \{ s\.on = !s\.on; render\(\); \}/);
});

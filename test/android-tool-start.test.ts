// What the build says when a tool cannot start: the cause, and the setup step when the tool is missing.
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startProblem } from '../android/toolchain.ts';

test('a missing tool says it could not start, and to run the setup', () => {
  const e = Object.assign(new Error('spawnSync aapt2 ENOENT'), { code: 'ENOENT' });
  assert.equal(startProblem('tools/aapt2.exe', e), 'could not start tools/aapt2.exe: ENOENT. Run node android/setup-tools.ts first.');
});

test('another start error is named, without the setup hint', () => {
  const e = Object.assign(new Error('spawnSync aapt2 EACCES'), { code: 'EACCES' });
  assert.equal(startProblem('tools/aapt2.exe', e), 'could not start tools/aapt2.exe: EACCES.');
});

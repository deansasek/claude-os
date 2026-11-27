// The usage poll waits out a rate-limit back-off, and polls again if the PC clock went back (src/apps/claude/server/limits.ts
// backoffOver). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-limits-backoff-'));
process.env.CLAUDEOS_STATE_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { backoffOver } = await import('../src/apps/claude/server/limits.ts');

const MIN = 60e3;

test('before the back-off deadline the poll waits', () => {
  assert.equal(backoffOver(1000, 1000 + 5 * MIN, 5 * MIN), false);
});

test('at or after the back-off deadline the poll runs', () => {
  assert.equal(backoffOver(1000 + 5 * MIN, 1000 + 5 * MIN, 5 * MIN), true);
});

test('a deadline further out than the wait means the clock went back, so the poll runs', () => {
  assert.equal(backoffOver(1000, 1000 + 24 * 60 * MIN, 30 * MIN), true);
});

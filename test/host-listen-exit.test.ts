// The Hub's listen error and the host's restart rule use one exit code (src/core/server/exit.ts). A listen that fails
// exits with it, and the host does not restart on it. Checked in the source, since a real listen needs the port.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { EXIT_CANNOT_LISTEN } from '../src/core/server/exit.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the exit code is set', () => {
  assert.equal(typeof EXIT_CANNOT_LISTEN, 'number');
  assert.ok(EXIT_CANNOT_LISTEN > 1);
});

test('the Hub exits with that code when it cannot listen, and the host checks for it', () => {
  assert.match(read('src/core/server/index.ts'), /server\.on\('error'[\s\S]*?process\.exit\(EXIT_CANNOT_LISTEN\)/);
  assert.match(read('host/host.ts'), /code === EXIT_CANNOT_LISTEN\) \{[\s\S]*?not restarting/);
});

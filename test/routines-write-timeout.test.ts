// The Routines list read, save and delete give up on a PC that does not answer (src/apps/routines/web/index.ts refresh,
// save, remove) and the run list read gives up too (src/apps/routines/web/run.ts loadRoutines). The module talks to the
// tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/routines/web');
const index = readFileSync(path.join(dir, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const run = readFileSync(path.join(dir, 'run.ts'), 'utf8').replace(/\r\n/g, '\n');

test('the list, save and delete calls pass a timeout', () => {
  assert.match(index, /const LIST_TIMEOUT_MS = 10e3;/);
  assert.match(index, /const WRITE_TIMEOUT_MS = 15e3;/);
  assert.match(index, /getJson<RoutinesResult>\(`\$\{API\}\/list`, LIST_TIMEOUT_MS\)/);
  assert.match(index, /postJson<RoutinesResult>\(`\$\{API\}\/save`, \{ routine \}, WRITE_TIMEOUT_MS\)/);
  assert.match(index, /postJson<RoutinesResult>\(`\$\{API\}\/delete`, \{ id \}, WRITE_TIMEOUT_MS\)/);
});

test('the run list read passes a timeout', () => {
  assert.match(run, /const LIST_TIMEOUT_MS = 10e3;/);
  assert.match(run, /getJson<RoutinesResult>\('\/api\/routines\/list', LIST_TIMEOUT_MS\)/);
});

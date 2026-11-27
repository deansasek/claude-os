// The routine sync gives up on a PC that does not answer, so queued edits send and due routines run (src/apps/routines/web/sync.ts).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/routines/web/sync.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the sync timeout is defined, and all three PC calls pass it', () => {
  assert.match(src, /const SYNC_TIMEOUT_MS = 20e3;/);
  assert.match(src, /postJson<RoutinesResult>\(`\$\{API\}\/\$\{op\.path\}`, op\.body, SYNC_TIMEOUT_MS\)/);
  assert.match(src, /getJson<RoutinesResult>\(`\$\{API\}\/list`, SYNC_TIMEOUT_MS\)/);
  assert.match(src, /postJson<RoutinesResult>\(`\$\{API\}\/restore`, \{ routines: copy \}, SYNC_TIMEOUT_MS\)/);
});

test('a timed-out send stays queued: its catch returns before the queue is shifted', () => {
  assert.match(src, /catch \{ return; \}\s*if \(!r \|\| \(!r\.ok && r\.retry\)\) return;/);
  assert.ok(src.indexOf('queue.shift();') > src.indexOf('catch { return; }'), 'the shift comes after the send');
});

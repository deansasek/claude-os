// The Lists write to the PC gives up when the PC does not answer: the Nest Hub and PC page send (src/apps/lists/web/index.ts
// send) and the outside writer (src/apps/lists/web/readers.ts writeList, used by voice). A timed-out write in writeList
// still queues the change to the tablet copy. The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/lists/web');
const index = readFileSync(path.join(dir, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const readers = readFileSync(path.join(dir, 'readers.ts'), 'utf8').replace(/\r\n/g, '\n');

test('the send on the no-copy path passes the sync timeout', () => {
  assert.match(index, /const SYNC_TIMEOUT_MS = 20e3;/);
  assert.match(index, /postJson<ListsResult>\(`\$\{API\}\/\$\{path\}`, body, SYNC_TIMEOUT_MS\)/);
});

test('the outside writer passes a write timeout, and the queue path is still there', () => {
  assert.match(readers, /const WRITE_TIMEOUT_MS = 20e3;/);
  assert.match(readers, /postJson<ListsResult>\(`\/api\/lists\/\$\{path\}`, body, WRITE_TIMEOUT_MS\)/);
  assert.match(readers, /if \(next\.queue\) \{ appendOp\(\{ path, body \}\); queued = true; \}/);
});

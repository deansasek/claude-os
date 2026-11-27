// The Lists queued send and list reads give up on a PC that does not answer, so tablet changes keep reaching the PC
// (src/apps/lists/web/index.ts). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/lists/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function flush(');
const flushBody = src.slice(start, src.indexOf('\n}\n', start));

test('the sync timeout is defined, and the queued send, suggest, lists and restore calls pass it', () => {
  assert.match(src, /const SYNC_TIMEOUT_MS = 20e3;/);
  assert.match(flushBody, /postJson<ListsResult>\(`\$\{API\}\/\$\{op\.path\}`, op\.body, SYNC_TIMEOUT_MS\)/);
  assert.match(src, /getJson<\{ items: string\[\] \}>\(`\$\{API\}\/suggest\?list=shopping`, SYNC_TIMEOUT_MS\)/);
  assert.match(src, /getJson<ListsResult>\(`\$\{API\}\/lists`, SYNC_TIMEOUT_MS\)/);
  assert.match(src, /postJson<ListsResult>\(`\$\{API\}\/restore`, \{ lists \}, SYNC_TIMEOUT_MS\)/);
});

test('a timed-out send stays queued: its catch returns before the op is removed', () => {
  assert.match(flushBody, /catch \{ return; \}/);
  assert.ok(flushBody.indexOf('catch { return; }') < flushBody.indexOf('removeOp(op.key!);'), 'the return comes before the op is removed');
});

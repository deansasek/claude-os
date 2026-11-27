// The Claude panel's reply poll gives up on a read that never answers, and drops a reply for a session it has left
// (src/apps/browser/web/claude-panel.ts watch). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/browser/web/claude-panel.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function watch(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the poll read has a timeout, so a read that never answers cannot stall the panel', () => {
  assert.ok(start > 0, 'watch() exists');
  const line = body.split('\n').find(l => l.includes('/api/claude/session?id='));
  assert.ok(line, 'the poll read is in watch()');
  assert.match(line, /READ_TIMEOUT_MS\)/);
  assert.match(src, /const READ_TIMEOUT_MS = 8000;/);
});

test('a reply is dropped when the panel has moved to another session, both on success and on failure', () => {
  assert.match(body, /const id = sessionId;/);
  const guard = /if \(sessionId !== id\) return;/g;
  const found = body.match(guard) ?? [];
  assert.equal(found.length, 2);
  const read = body.indexOf('await getJson<SessionView>');
  for (const m of body.matchAll(guard)) {
    assert.ok((m.index as number) > read, 'each guard comes after the read');
  }
});

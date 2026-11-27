// The open Claude session's poll gives up on a hung read, and an answer older than the one already applied is dropped
// (src/apps/claude/web/reply.ts refresh). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/reply.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function refresh(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the poll read has a timeout, so a read that never answers counts as a miss', () => {
  assert.ok(start > 0, 'refresh() exists');
  const line = body.split('\n').find(l => l.includes('/api/claude/session?id='));
  assert.ok(line, 'the poll read is in refresh()');
  assert.match(line, /READ_TIMEOUT_MS\)/);
  assert.match(src, /const READ_TIMEOUT_MS = 8000;/);
});

test('each poll takes the next number, and an older answer is dropped before it is painted', () => {
  const seq = body.indexOf('const seq = ++refreshSeq;');
  assert.ok(seq > 0, 'the number is taken');
  const guard = body.indexOf('if (seq < appliedSeq) return;', seq);
  const paint = body.indexOf('view = v;');
  assert.ok(guard > seq && paint > guard, 'the guard comes before the answer is applied');
  assert.match(body, /appliedSeq = seq;/);
});

test('a late failure is also dropped once a newer read has answered', () => {
  const catchAt = body.search(/\bcatch \{/);
  assert.ok(catchAt > 0, 'the failure path exists');
  assert.ok(body.indexOf('if (seq < appliedSeq) return;', catchAt) > catchAt, 'the failure path checks the number');
});

// The voice reply follower gives up on a session read the PC never answers (src/apps/claude/web/voice.ts watch).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/claude/web/voice.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function watch(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the poll read has a timeout, so a read that never answers cannot stall the follower', () => {
  assert.ok(start > 0, 'watch() exists');
  const line = body.split('\n').find(l => l.includes('encodeURIComponent(c.sessionId)}'));
  assert.ok(line, 'the poll read is in watch()');
  assert.match(line, /READ_TIMEOUT_MS\)/);
  assert.match(src, /const READ_TIMEOUT_MS = 8000;/);
});

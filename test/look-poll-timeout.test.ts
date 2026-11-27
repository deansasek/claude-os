// Look's reply poll gives up on a read that never answers (src/apps/camera/web/look.ts follow). The module talks to the
// tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/look.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function follow(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the poll reads the session with a timeout, so a read that never answers cannot stall it', () => {
  assert.ok(start > 0, 'follow() exists');
  const line = body.split('\n').find(l => l.includes('encodeURIComponent(id)}'));
  assert.ok(line, 'the poll read is in follow()');
  assert.match(line, /READ_TIMEOUT_MS\)/);
  assert.match(src, /const READ_TIMEOUT_MS = 8000;/);
});

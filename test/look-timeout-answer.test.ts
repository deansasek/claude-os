// Look tells the user when Claude is still working after three minutes (src/apps/camera/web/look.ts, follow).
// The Look screen is DOM code with no unit seam, so this reads the source of follow(). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/look.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function follow(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('when the wait runs out, Look says Claude is still working and where to see the answer', () => {
  assert.ok(start > 0, 'follow() exists');
  const loopEnd = body.indexOf('\n  }\n', body.indexOf('while ('));
  const line = body.indexOf('Claude is still working on it. Open ClaudeOS to see the answer.');
  assert.ok(line > loopEnd, 'the line comes after the wait loop');
  assert.match(body.slice(line), /say\(line\);/);
});

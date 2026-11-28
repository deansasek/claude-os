// A Photos delete gives up on a PC that does not answer, so the sheet's Delete and Keep work again (src/apps/photos/web/index.ts removePending).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/photos/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function removePending(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the delete timeout is set, and each batch passes it', () => {
  const m = src.match(/const DELETE_TIMEOUT_MS = ([\d.e]+);/);
  assert.ok(m, 'DELETE_TIMEOUT_MS is defined');
  assert.ok(Number(m[1]) > 0 && Number(m[1]) <= 30e3);
  assert.match(body, /postJson<PhotoDeleteResult>\('\/api\/photos\/delete', [\s\S]*?, DELETE_TIMEOUT_MS\)/);
});

test('a batch that gives up still sets refused, so the sheet turns its buttons back on', () => {
  assert.match(body, /catch \{\s*r = null;\s*\}/);
  assert.match(body, /if \(!r \|\| \(!r\.ok && !r\.deleted && !r\.missing\)\) \{ refused = true; break; \}/);
});

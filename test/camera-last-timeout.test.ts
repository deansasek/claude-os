// The camera's last-photo read gives up on a PC that does not answer, and a late older read does not show an older thumbnail
// (src/apps/camera/web/index.ts refreshLast). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function refreshLast(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the last-photo read has a 20 second timeout', () => {
  assert.match(src, /const LAST_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<PhotoList>\('\/api\/photos\/list\?limit=1', LAST_TIMEOUT_MS\)/);
});

test('each read takes the next number before it waits, and the check comes before the thumbnail is set', () => {
  assert.ok(body.indexOf('const n = ++lastSeq;') >= 0, 'the number is taken');
  assert.ok(body.indexOf('const n = ++lastSeq;') < body.indexOf('await getJson'), 'the number is taken before the read');
  const guard = body.indexOf('if (n !== lastSeq) return;');
  assert.ok(guard > 0, 'the check exists');
  assert.ok(guard < body.indexOf('img.src = src'), 'the check comes before the image is set');
  assert.ok(guard < body.indexOf("classList.toggle('empty'"), 'the check comes before the button state changes');
});

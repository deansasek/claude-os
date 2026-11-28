// The browser photo upload gives up on a PC that does not answer (src/apps/camera/web/camera.ts captureWeb), so the
// shutter in index.ts works again. The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/camera.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function captureWeb(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the upload has a timeout signal', () => {
  assert.ok(start > 0, 'captureWeb() exists');
  assert.match(src, /const UPLOAD_TIMEOUT_MS = 20e3;/);
  assert.match(body, /fetch\('\/api\/photos\/upload', \{ method: 'POST', headers: \{[^}]*\}, body: blob, signal: AbortSignal\.timeout\(UPLOAD_TIMEOUT_MS\) \}\)/);
});

test('a timed-out upload still returns the failed result', () => {
  assert.match(body, /\} catch \{\s*return \{ ok: false, code: 'failed' \};\s*\}/);
});

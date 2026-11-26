// A good photo clears the failure message left by an earlier shot (src/apps/camera/web/index.ts). The page needs the
// DOM and the tablet bridge, so this reads the source of shoot()'s success path. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function shoot()');
const body = src.slice(start, src.indexOf('function showShot(', start));

test('a good photo hides the failure message before the shot is shown', () => {
  assert.ok(start > 0, 'shoot() exists');
  const failed = body.indexOf('if (!s.ok)');
  const clear = body.indexOf("$('caMsg').hidden = true;");
  const show = body.indexOf('showShot(s.id, s.url);');
  assert.ok(failed > 0 && clear > failed, 'the message is cleared after the failure check, on the success path');
  assert.ok(show > clear, 'the message is cleared before showShot is called');
});

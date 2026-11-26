// Switch tries the camera again after a failed open (src/apps/camera/web/camera.ts): flip() calls show() when the last open failed,
// and show() clears that flag first. The module talks to the tablet bridge at load, so this reads the source as text. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/camera.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const flipAt = src.indexOf('export function flip(');
const flipBody = src.slice(flipAt, src.indexOf('\n}\n', flipAt));
const showAt = src.indexOf('export function show(');
const showBody = src.slice(showAt, src.indexOf('\n}\n', showAt));

test('flip() calls show() when the last open failed and the preview is not open', () => {
  assert.ok(flipAt > 0, 'flip() exists');
  const off = flipBody.indexOf('if (!isOn) {');
  const retry = flipBody.indexOf('if (failed && wanted && target) show(target);');
  const ret = flipBody.indexOf('return;', retry);
  assert.ok(off > 0 && retry > off, 'the retry sits in the !isOn branch');
  assert.ok(ret > retry, 'the branch returns after the retry');
});

test('show() clears the failed flag before it opens the camera', () => {
  assert.ok(showAt > 0, 'show() exists');
  const clear = showBody.indexOf('failed = false;');
  const open = showBody.indexOf('camera.open(');
  assert.ok(clear > 0, 'show() clears failed');
  assert.ok(open > clear, 'the flag is cleared before the open');
});

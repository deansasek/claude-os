// A shutter tap after a camera error keeps the error on screen (src/apps/camera/web/index.ts). The page needs the DOM and
// the tablet bridge, so this reads the source of paintState() and shoot(). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('paintState records the preview state', () => {
  const start = src.indexOf('function paintState(');
  const body = src.slice(start, src.indexOf('function flash(', start));
  assert.match(body, /camState = state;/);
});

test('shoot keeps the error or the off message: "still starting" is written only for other states', () => {
  const start = src.indexOf('async function shoot()');
  const body = src.slice(start, src.indexOf('shooting = true;', start));
  assert.match(body, /if \(camState !== 'error' && camState !== 'closed'\) \$\('caMsgText'\)\.textContent = 'The camera is still starting\.';/);
  assert.match(body, /\$\('caMsg'\)\.hidden = false;\s*return;/);
});

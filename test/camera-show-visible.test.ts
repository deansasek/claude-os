// The Camera starts its preview only while Camera is still on screen (src/apps/camera/web/index.ts onShow). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  onShow() {');
const body = src.slice(start, src.indexOf('  onHide()', start));

// The page slides in for 320 ms; if the user leaves in that time, onHide runs first and the timer must not open the camera.
test('the delayed preview checks that Camera is still on screen before it opens the camera', () => {
  assert.ok(start > 0, 'onShow() exists');
  const timer = body.indexOf('setTimeout(');
  const visible = body.indexOf('ctx.isVisible()');
  const show = body.indexOf('cam.show(');
  assert.ok(timer > 0 && show > timer, 'the preview opens from the delayed timer');
  assert.ok(visible > timer && visible < show, 'the visibility check comes before cam.show() in that timer');
});

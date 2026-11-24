// A camera preview that opens after its screen has closed is closed again (src/apps/camera/web/camera.ts).
// The module talks to the tablet bridge at load, so this reads the source of its 'opened' handler. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/camera/web/camera.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf("case 'opened':");
const handler = src.slice(start, src.indexOf("case 'closed':", start));

test('an opened preview is closed, not shown, when no screen wants the camera any more', () => {
  assert.ok(start > 0, "the 'opened' case exists");
  const check = handler.indexOf('if (!wanted)');
  const close = handler.indexOf('camera.close();');
  const show = handler.indexOf("isOn = true; emit('open')");
  assert.ok(check > 0 && close > check, 'the wanted check closes the camera');
  assert.ok(show > close, 'the open state is set only after that check');
});

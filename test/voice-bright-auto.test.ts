// Voice brightness does not change the screen while Android's auto-brightness is on (src/core/web/voice-commands.ts brightness).
// The command handler needs the browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function brightness(to: number');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('brightness reads auto-brightness first and says so, without setting the saved brightness', () => {
  assert.ok(start > 0, 'brightness() exists');
  const guard = body.indexOf('if (autoBrightness.on) return');
  const set = body.indexOf('prefs.brightness = v;');
  assert.ok(guard > 0 && guard < set, 'the auto-brightness guard runs before the saved brightness is set');
  assert.match(body, /Auto-brightness is on, so the screen sets its own brightness\./);
});

test('autoBrightness is imported from the system module', () => {
  assert.match(src, /import \{ autoBrightness, openApp, prefs, sleep \} from '\.\/system\.ts';/);
});

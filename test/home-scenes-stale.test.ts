// The Home scene list read gives up on a PC that does not answer, and a late older read does not bring back old scene buttons
// (src/apps/home/web/index.ts loadScenes). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadScenes(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the scene list read has a timeout', () => {
  assert.ok(start > 0, 'loadScenes() exists');
  assert.match(src, /const SCENES_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<HaScenes>\('\/api\/home-assistant\/scenes', SCENES_TIMEOUT_MS\)/);
});

test('each read takes the next number, and only the newest read sets the buttons', () => {
  assert.match(body, /const seq = \+\+scenesSeq;/);
  const guard = body.indexOf('if (seq !== scenesSeq) return;');
  assert.ok(guard > 0, 'the number is checked');
  assert.ok(guard < body.indexOf('sceneActs = next;'), 'the check comes before the buttons are set');
});

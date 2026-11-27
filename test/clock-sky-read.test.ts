// The Clock sky read gives up on a PC that does not answer, follows a new Weather place, and a late older read does not paint over
// a newer one (src/apps/clock/web/index.ts refreshSky). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/clock/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function refreshSky(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the sky read has a timeout, and no raw fetch of the forecast is left', () => {
  assert.ok(start > 0, 'refreshSky() exists');
  assert.match(src, /const SKY_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<\{ current\?: \{ weather_code\?: number \} \}>\('\/api\/weather\/forecast', SKY_TIMEOUT_MS\)/);
  assert.doesNotMatch(src, /fetch\('\/api\/weather\/forecast'/);
});

test('each read takes the next number, and the check comes before the sky is set', () => {
  assert.match(body, /const seq = \+\+skySeq;/);
  assert.ok(body.indexOf('if (seq !== skySeq) return;') > 0, 'the check exists');
  assert.ok(body.indexOf('if (seq !== skySeq) return;') < body.indexOf('sky = skyOf('), 'the check comes before the sky is set');
});

test('a new Weather place or unit reads the sky again', () => {
  assert.match(src, /addEventListener\('hub:weather', \(\) => \{ void refreshSky\(\); \}\);/);
});

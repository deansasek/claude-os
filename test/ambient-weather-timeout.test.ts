// The ambient screen's weather read gives up on a PC that does not answer, and a late older read does not paint an old place
// (src/core/web/system.ts loadWeather). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/system.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadWeather(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the forecast read has a 20 second timeout', () => {
  assert.match(src, /const WX_TIMEOUT_MS = 20e3;/);
  assert.match(body, /\}>\('\/api\/weather\/forecast', WX_TIMEOUT_MS\)/);
});

test('each read takes the next number, and both paths drop a read that is no longer the newest', () => {
  assert.match(body, /const seq = \+\+wxSeq;/);
  const guards = body.match(/if \(seq !== wxSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(body.indexOf('if (seq !== wxSeq) return;') < body.indexOf('wx = {'), 'the first check comes before the chip is set');
});

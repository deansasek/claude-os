// The Routines scene read gives up on a PC that does not answer, and a late older read does not change the scene picker
// (src/apps/routines/web/index.ts loadScenes). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/routines/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadScenes(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the scene read has a timeout', () => {
  assert.ok(start > 0, 'loadScenes() exists');
  assert.match(src, /const SCENES_TIMEOUT_MS = 20e3;/);
  assert.match(body, /getJson<HaScenes>\('\/api\/home-assistant\/scenes', SCENES_TIMEOUT_MS\)/);
});

test('each read takes the next number, and both paths drop a read that is no longer the newest', () => {
  assert.match(body, /const seq = \+\+scenesSeq;/);
  const guards = body.match(/if \(seq !== scenesSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(body.indexOf('if (seq !== scenesSeq) return;') < body.indexOf('scenesWhy = r?.status'), 'the first check comes before the picker is set');
});

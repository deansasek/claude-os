// The Home Assistant device and scene reads give up on a PC that does not answer, and a late older scene read does not undo a newer one
// (src/apps/home-assistant/web/index.ts loadDevices, loadScenes). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const devices = slice('async function loadDevices(');
const scenes = slice('async function loadScenes(');

test('the device read has a timeout', () => {
  assert.match(devices, /getJson<HaDevices>\(`\$\{API\}\/devices`, READ_TIMEOUT_MS\)/);
});

test('the scene read has a timeout', () => {
  assert.match(scenes, /getJson<HaScenes>\(`\$\{API\}\/scenes`, READ_TIMEOUT_MS\)/);
});

test('each scene read takes the next number, and both paths drop a read that is no longer the newest', () => {
  assert.match(scenes, /const gen = \+\+scenesGen;/);
  const guards = scenes.match(/if \(gen !== scenesGen\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(scenes.indexOf('if (gen !== scenesGen) return;') < scenes.indexOf('sceneList = s;'), 'the check comes before the list is set');
});

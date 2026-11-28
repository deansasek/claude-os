// A device read that started before a config save or an allow switch cannot leave the old device list on screen
// (src/apps/home-assistant/web/index.ts loadDevices, saveConfig, setAllowed). The module talks to the tablet at load,
// so this reads its source. Run with: npm test
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
const load = slice('async function loadDevices(');

test('loadDevices takes the next number and only the newest read sets the list', () => {
  assert.match(src, /let devicesGen = 0;/);
  assert.match(load, /const gen = \+\+devicesGen;/);
  const guards = load.match(/if \(gen !== devicesGen\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.match(load, /if \(gen === devicesGen\) devicesBusy = false;/);
});

test('a plain call still returns while a read runs, and a save or allow switch starts a fresh one', () => {
  assert.match(load, /if \(devicesBusy && !fresh\) return;/);
  assert.match(slice('async function saveConfig('), /void loadDevices\(true\);/);
  assert.match(slice('async function setAllowed('), /await loadDevices\(true\);[\s\S]*await loadDevices\(true\);/);
});

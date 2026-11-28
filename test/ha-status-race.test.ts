// A late older Home Assistant status read does not overwrite the status that a config save just set
// (src/apps/home-assistant/web/index.ts loadStatus, saveConfig). The module talks to the tablet at load, so this reads
// its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadStatus(');
const body = src.slice(start, src.indexOf('\n}\n', start));
const save = src.slice(src.indexOf('async function saveConfig('), src.indexOf('\n}\n', src.indexOf('async function saveConfig(')));

test('loadStatus takes the next number and drops an answer that is no longer the newest', () => {
  assert.ok(start > 0, 'loadStatus() exists');
  assert.match(src, /let statusGen = 0;/);
  assert.match(body, /const gen = \+\+statusGen;/);
  const guards = body.match(/if \(gen !== statusGen\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
});

test('a config save bumps the status number before it sets the status', () => {
  const bump = save.indexOf('statusGen++;');
  const set = save.indexOf('status = r;');
  assert.ok(bump > 0 && set > bump, 'the bump comes before the save sets the status');
});

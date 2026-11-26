// The Home Assistant config on a scratch file: a readable one loads; a broken one is moved aside, never kept as a base.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-ha-'));
const file = path.join(dir, 'ha-config.json');
process.env.CLAUDEOS_HA_CONFIG = file;

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a readable config loads with its fields', async () => {
  fs.writeFileSync(file, JSON.stringify({ address: 'http://ha.local:8123', token: 'abc', allow: ['light.kitchen'] }));
  const ha = await import('../src/apps/home-assistant/server/ha.ts');
  assert.equal(ha.isDemo(), false);
  assert.equal(fs.existsSync(file), true, 'a good config is left where it is');
});

test('a broken config is moved aside as .corrupt, and nothing is saved over it', async () => {
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '{ "token": "keep-me", broken');
  await import(`../src/apps/home-assistant/server/ha.ts?broken=${Date.now()}`);
  assert.equal(fs.existsSync(file), false, 'the broken file is no longer in place');
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{ "token": "keep-me", broken');
});

test('a config the PC cannot write is reported, not saved silently', async () => {
  // a folder that does not exist: the write fails, and the save must say so
  process.env.CLAUDEOS_HA_CONFIG = path.join(dir, 'no-such-folder', 'ha-config.json');
  const ha = await import(`../src/apps/home-assistant/server/ha.ts?unwritable=${Date.now()}`);
  const res = ha.saveConfig({ address: 'http://ha.local:8123' });
  assert.equal(res.ok, false, 'a save that fails says so');
  assert.match(res.message ?? '', /couldn’t save/);
});

test('a second broken config is kept as .2.corrupt, and the first .corrupt copy (with its token) is unchanged', async () => {
  process.env.CLAUDEOS_HA_CONFIG = file;   // the test above points the variable elsewhere
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '{ "token": "second-broken", broken');
  await import(`../src/apps/home-assistant/server/ha.ts?second=${Date.now()}`);
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{ "token": "keep-me", broken', 'the first copy is not replaced');
  assert.equal(fs.readFileSync(`${file}.2.corrupt`, 'utf8'), '{ "token": "second-broken", broken');
});

test('a config that is valid JSON but not an object loads as not set up, and does not throw', async () => {
  process.env.CLAUDEOS_HA_CONFIG = file;
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '[]');
  const ha = await import(`../src/apps/home-assistant/server/ha.ts?array=${Date.now()}`);
  assert.equal(ha.isDemo(), false);
});

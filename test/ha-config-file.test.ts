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

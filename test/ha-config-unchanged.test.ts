// Saving the same Home Assistant address and token writes nothing, but a save after a failed write tries again.
// The config is a scratch file; a folder where the temp file goes makes the write fail. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-ha-same-'));
const file = path.join(dir, 'ha-config.json');
process.env.CLAUDEOS_HA_CONFIG = file;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

fs.writeFileSync(file, JSON.stringify({ address: 'http://ha.local:8123', token: 'abc', allow: [] }));
const ha = await import('../src/apps/home-assistant/server/ha.ts');

test('saving the same address and token writes nothing, even when the write would fail', () => {
  fs.mkdirSync(`${file}.tmp`);   // a write would fail here
  try {
    assert.equal(ha.saveConfig({ address: 'http://ha.local:8123', token: 'abc' }).ok, true);
  } finally {
    fs.rmdirSync(`${file}.tmp`);
  }
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'abc');
});

test('after a failed write, saving the same change tries again', () => {
  fs.mkdirSync(`${file}.tmp`);
  try {
    assert.equal(ha.saveConfig({ token: 'new' }).ok, false);
    assert.equal(ha.saveConfig({ token: 'new' }).ok, false, 'the retry is still tried, so it fails again');
  } finally {
    fs.rmdirSync(`${file}.tmp`);
  }
  assert.equal(ha.saveConfig({ token: 'new' }).ok, true, 'once the PC can write, the retry saves it');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'new');
});

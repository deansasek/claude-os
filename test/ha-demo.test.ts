// The Home Assistant app with no address or token: it reports "not set up" and shows no made-up devices. The demo
// house comes back only under CLAUDEOS_HA_DEMO=1 (a test switch), and a demo field in the saved config is ignored.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-ha-demo-'));
const file = path.join(dir, 'ha-config.json');
process.env.CLAUDEOS_HA_CONFIG = file;

after(() => {
  delete process.env.CLAUDEOS_HA_DEMO;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh copy of the server module, so each test reads its own config file. */
type HaModule = typeof import('../src/apps/home-assistant/server/ha.ts');
const fresh = (tag: string): Promise<HaModule> => import(`../src/apps/home-assistant/server/ha.ts?demo=${tag}`) as Promise<HaModule>;

test('no address or token: not set up, and no made-up devices', async () => {
  delete process.env.CLAUDEOS_HA_DEMO;
  fs.rmSync(file, { force: true });
  const ha = await fresh('empty');
  assert.equal(ha.isDemo(), false);
  assert.equal(ha.status().demo, false);
  assert.equal(ha.status().configured, false);

  const e = await ha.entities();
  assert.equal(e.status, 'not_set_up');
  assert.deepEqual(e.entities, []);
  assert.match(e.error ?? '', /Settings/);

  const d = await ha.devices();
  assert.equal(d.status, 'not_set_up');
  assert.deepEqual(d.devices, []);

  const db = await ha.dashboard();
  assert.equal(db.status, 'not_set_up');
  assert.deepEqual(db.entities, []);

  const sc = await ha.scenes();
  assert.equal(sc.status, 'not_set_up');
  assert.deepEqual(sc.scenes, []);
});

test('an address without a token is still not set up', async () => {
  delete process.env.CLAUDEOS_HA_DEMO;
  fs.writeFileSync(file, JSON.stringify({ address: 'http://ha.local:8123', allow: [] }));
  const ha = await fresh('no-token');
  assert.equal(ha.isDemo(), false);
  assert.equal((await ha.entities()).status, 'not_set_up');
});

test('a demo field in the saved config is ignored', async () => {
  delete process.env.CLAUDEOS_HA_DEMO;
  fs.writeFileSync(file, JSON.stringify({ demo: true }));
  const ha = await fresh('demo-field');
  assert.equal(ha.isDemo(), false);
  assert.equal(ha.status().demo, false);
  assert.equal((await ha.entities()).status, 'not_set_up');
});

test('CLAUDEOS_HA_DEMO=1: the demo house is returned', async () => {
  process.env.CLAUDEOS_HA_DEMO = '1';
  fs.rmSync(file, { force: true });
  const ha = await fresh('test-switch');
  assert.equal(ha.isDemo(), true);
  assert.equal(ha.status().demo, true);
  const e = await ha.entities();
  assert.equal(e.status, 'ok');
  assert.equal(e.demo, true);
  assert.ok(e.entities.some(x => x.entity_id === 'light.kitchen'));
  delete process.env.CLAUDEOS_HA_DEMO;
});

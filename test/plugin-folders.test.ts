// Plugin folders match by path without regard to letter case (src/apps/settings/server/plugins.ts). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The plugin module keeps its state in the hub folder (plugins-state.json). Remove that file before and after the run.
const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(HUB, 'plugins-state.json');
fs.rmSync(STATE, { force: true });
const P = await import('../src/apps/settings/server/plugins.ts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-plugin-'));
const demo = path.join(dir, 'Demo');
fs.mkdirSync(path.join(demo, 'skills'), { recursive: true });
const cwd = path.join(dir, 'project');
fs.mkdirSync(cwd);

after(() => {
  P.removeFolder(demo);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(STATE, { force: true });
});

// The plugin folders the next turn would load.
const loaded = () => (P.turnPluginOptions(cwd).plugins ?? []).map(p => p.path);

test('the same plugin folder, with other letter case, is added once and removed in full', (t) => {
  const lower = demo.toLowerCase();
  // Only a case-insensitive file system (Windows) has a second spelling of the same folder.
  if (!fs.existsSync(lower) || lower === demo) return t.skip('no case-insensitive path to test');
  assert.deepEqual(P.addFolder(demo), { ok: true });
  assert.deepEqual(P.addFolder(lower), { ok: true });
  assert.equal(loaded().length, 1);
  assert.equal(P.removeFolder(lower), true);
  assert.equal(loaded().length, 0);
  assert.equal(P.removeFolder(demo), false);
});

test('a plugin folder adds once and removes once', () => {
  assert.deepEqual(P.addFolder(demo), { ok: true });
  assert.deepEqual(P.addFolder(demo), { ok: true });
  assert.equal(loaded().length, 1);
  assert.equal(P.removeFolder(demo), true);
  assert.equal(loaded().length, 0);
});

// The plugins list read gives up after PLUGINS_TIMEOUT_MS (src/apps/settings/web/plugins.ts, loadPlugins). The Settings Plugins screen is DOM
// code with no unit seam, so this reads the source of loadPlugins(). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/plugins.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('export async function loadPlugins(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the plugins list read gives up after PLUGINS_TIMEOUT_MS', () => {
  assert.ok(start > 0, 'loadPlugins() exists');
  assert.match(body, /getJson<PluginsView>\([^;]*, PLUGINS_TIMEOUT_MS\)/);
  assert.match(src, /const PLUGINS_TIMEOUT_MS = 60_000;/);
});

test('a failed plugins read marks the kept list as out of date', () => {
  assert.match(body, /stale = false;/, 'a good read clears stale');
  assert.match(body, /catch \{ stale = view !== null;/, 'the catch marks stale only when a list was kept');
});

test('paintPlugins says the kept list may be out of date and shows the recheck control', () => {
  const at = src.indexOf('export function paintPlugins(');
  const paint = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(at > 0, 'paintPlugins() exists');
  assert.ok(paint.includes('Couldn’t reach your PC, so this list may be out of date.'), 'out-of-date note');
  assert.match(paint, /else if \(stale\) \{[^}]*again\.hidden = false;/, 'recheck control shown when stale');
});

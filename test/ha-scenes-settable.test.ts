// ha_list_entities lists the scenes ha_activate_scene can set, and says which ones to add to Home (src/apps/home-assistant/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/home-assistant/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the scene list groups the settable scenes apart from the ones to add to Home', () => {
  assert.ok(tools.includes("const settable = sc.status === 'ok' ? sc.scenes.filter(x => x.dashboard || x.home) : [];"));
  assert.ok(tools.includes('Scenes you can set (ha_activate_scene)'));
  assert.ok(tools.includes('Scenes not on Home (the user can add them there)'));
  assert.ok(tools.includes("if (r.status === 'not_set_up') return text(r.error ?? 'Home Assistant isn’t set up yet.', true);"));
});

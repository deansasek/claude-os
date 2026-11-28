// ha_call_service says when the change was made in the demo house, as ha_activate_scene does (src/apps/home-assistant/server/tools.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tools = readFileSync(new URL('../src/apps/home-assistant/server/tools.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the ha_call_service reply carries the demo-house note, from isDemo, with or without an entity', () => {
  assert.ok(tools.includes("const demo = isDemo() ? ' (demo house: nothing real was switched)' : '';"));
  assert.ok(tools.includes("is now ${e.state}${e.target != null ? `, set to ${e.target}${e.unit ?? ''}` : ''}${demo}.` : `Done.${demo}`);"));
});

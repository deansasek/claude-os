// Claude's set_dnd tool turns Do Not Disturb on or off, with the same flag the Control Center and the voice use (prefs.dnd).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check } from '../src/apps/claude/server/tablet.ts';

test('set_dnd needs a yes or no, and passes it on', () => {
  assert.deepEqual(check('dnd', { on: true }), { ok: true, op: 'dnd', args: { on: true } });
  assert.deepEqual(check('dnd', { on: false }), { ok: true, op: 'dnd', args: { on: false } });
  const bad = check('dnd', { on: 'yes' });
  assert.equal(bad.ok, false);
});

test('the relay sets prefs.dnd and says when it is already so, as the voice does', () => {
  const relay = readFileSync(new URL('../src/apps/claude/web/browser-relay.ts', import.meta.url), 'utf8');
  assert.ok(relay.includes("if (prefs.dnd === a.on) return { ok: true, data: `Do Not Disturb is already ${a.on ? 'on' : 'off'}.` };"));
  assert.ok(relay.includes("if (job.op === 'dnd') return runDnd(job.args || {});"));
});

test('the tool is wired and its approval card has plain words', () => {
  const tablet = readFileSync(new URL('../src/apps/claude/server/tablet.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(tablet.includes("tool('set_dnd',"));
  assert.ok(cards.includes("'mcp__claudeos_tablet__set_dnd': { now: 'Change Do Not Disturb', past: 'Changed Do Not Disturb', doing: 'Changing Do Not Disturb' },"));
});

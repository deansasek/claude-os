// Claude's set_volume tool reads or sets the tablet's media volume with the voice's steps and words (src/apps/claude/web/browser-relay.ts runVolume).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check } from '../src/apps/claude/server/tablet.ts';

test('set_volume checks its input: a level from 0 to 100, or one action, or nothing to read', () => {
  assert.deepEqual(check('volume', { level: 30 }), { ok: true, op: 'volume', args: { level: 30 } });
  assert.deepEqual(check('volume', { action: 'mute' }), { ok: true, op: 'volume', args: { action: 'mute' } });
  assert.deepEqual(check('volume', {}), { ok: true, op: 'volume', args: {} });
  assert.equal(check('volume', { level: 101 }).ok, false);
  assert.equal(check('volume', { level: 2.5 }).ok, false);
  assert.equal(check('volume', { action: 'loud' }).ok, false);
  assert.equal(check('volume', { level: 30, action: 'up' }).ok, false);
});

test('the relay sets the media volume with the voice’s steps and says the result', () => {
  const relay = readFileSync(new URL('../src/apps/claude/web/browser-relay.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(relay.includes("if (job.op === 'volume') return runVolume(job.args || {});"));
  assert.ok(relay.includes("action === 'up' ? clamp01(cur + .15)"));
  assert.ok(relay.includes("return { ok: true, data: 'Muted.' };"));
  assert.ok(relay.includes("return { ok: true, data: `Volume ${Math.round(v * 100)} percent.` };"));
  assert.ok(cards.includes("'mcp__claudeos_tablet__set_volume': { now: 'Change the volume', past: 'Changed the volume', doing: 'Changing the volume' },"));
});

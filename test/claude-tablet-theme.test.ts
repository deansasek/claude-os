// Claude's set_theme tool sets or reads the screen's mode with the modes Settings and the voice use (src/apps/claude/web/browser-relay.ts runTheme).
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check } from '../src/apps/claude/server/tablet.ts';

test('set_theme takes light, dark, time or system, or nothing to read', () => {
  assert.deepEqual(check('theme', { mode: 'dark' }), { ok: true, op: 'theme', args: { mode: 'dark' } });
  assert.deepEqual(check('theme', {}), { ok: true, op: 'theme', args: {} });
  assert.equal(check('theme', { mode: 'blue' }).ok, false);
});

test('the relay sets the mode through setThemeMode, and says when it is already so', () => {
  const relay = readFileSync(new URL('../src/apps/claude/web/browser-relay.ts', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/apps/claude/web/tools.ts', import.meta.url), 'utf8');
  assert.ok(relay.includes("if (job.op === 'theme') return runTheme(job.args || {});"));
  assert.ok(relay.includes("if (themeMode() === mode) return { ok: true, data: `It’s already in ${THEME_NAMES[mode]} mode.` };"));
  assert.ok(relay.includes('  setThemeMode(mode);'));
  assert.ok(cards.includes("'mcp__claudeos_tablet__set_theme': { now: 'Change the screen mode', past: 'Changed the screen mode', doing: 'Changing the screen mode' },"));
});

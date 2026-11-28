// adjust_timer refuses zero, and its description says so (src/apps/claude/server/tablet.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check } from '../src/apps/claude/server/tablet.ts';

test('adjust_timer takes whole minutes from -60 to 60 but not zero, and the check agrees', () => {
  assert.equal(check('adjust_timer', { minutes: 0 }).ok, false);
  assert.equal(check('adjust_timer', { minutes: 61 }).ok, false);
  assert.equal(check('adjust_timer', { minutes: 5 }).ok, true);
  assert.equal(check('adjust_timer', { minutes: -5 }).ok, true);
  const tablet = readFileSync(new URL('../src/apps/claude/server/tablet.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(tablet.includes('minutes: whole minutes from -60 to 60, not zero;'));
});

// The notify tool takes a title alone: its body is optional, as its check and the relay already treat it (src/apps/claude/server/tablet.ts). Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check } from '../src/apps/claude/server/tablet.ts';

test('a notification needs only a title; its body is optional in the schema and the check', () => {
  const tablet = readFileSync(new URL('../src/apps/claude/server/tablet.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(tablet.includes("{ title: z.string(), body: z.string().optional() },"));
  assert.ok(tablet.includes('body: optional, up to 80 characters. A title alone is enough.'));
  assert.equal(check('notify', { title: 'Build done' }).ok, true);
});

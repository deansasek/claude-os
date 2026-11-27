// A failed claude.ai calendar connector read shows the fixed text, not the SDK's raw error with a PC path
// (src/apps/calendar/server/connector-parse.ts connectorError). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectorError } from '../src/apps/calendar/server/connector-parse.ts';

test('a failed connector read gives the fixed text, with no PC path in it', () => {
  const r = connectorError(new Error('Claude Code executable not found at C:\\Users\\x\\cli.js'));
  assert.deepEqual(r, { status: 'error', error: 'Couldn’t read the claude.ai calendar connector.' });
  assert.equal(r.error.includes('C:'), false);
});

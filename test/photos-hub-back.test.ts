// The Photos list reloads when the PC is back, only while Photos is on screen (src/apps/photos/api.ts reloadOnHubBack). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reloadOnHubBack } from '../src/apps/photos/api.ts';

test('reloads only when the PC is reachable, Photos is on screen, and the last load did not reach the PC', () => {
  assert.equal(reloadOnHubBack(true, true, true), true);
});

test('does not reload when any of the three is missing', () => {
  assert.equal(reloadOnHubBack(false, true, true), false);
  assert.equal(reloadOnHubBack(true, false, true), false);
  assert.equal(reloadOnHubBack(true, true, false), false);
});

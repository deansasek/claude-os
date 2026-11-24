// The software update panel's words (src/apps/settings/web/update.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resultText, updateStatus } from '../src/apps/settings/web/update.ts';

test('updateStatus offers an update only when the PC has a newer build', () => {
  const newer = updateStatus({ status: 'ok', installed: 40, latest: 42 }, 42);
  assert.equal(newer.canUpdate, true);
  assert.equal(newer.text, 'Build 42 is ready on your PC. This tablet has 40.');
  assert.deepEqual(updateStatus({ status: 'ok', installed: 42 }, 42), { text: 'Up to date at build 42.', canUpdate: false });
});

test('updateStatus says what blocks a check', () => {
  assert.equal(updateStatus(null, 42).canUpdate, false);
  assert.equal(updateStatus({ status: 'not owner' }, 42).canUpdate, false);
  assert.equal(updateStatus({ status: 'ok', installed: 40 }, null).canUpdate, false);
  assert.equal(updateStatus({ status: 'error' }, 42).canUpdate, false);
});

test('resultText words the last attempt', () => {
  assert.equal(resultText({ status: 'updating', from: 40, to: 42 }), 'Updating to build 42. ClaudeOS restarts when it’s done.');
  assert.equal(resultText({ status: 'busy' }), 'An update is already running.');
  assert.equal(resultText({ status: 'error', error: 'http 404' }), 'Couldn’t update: http 404.');
  assert.equal(resultText({ status: 'error' }), 'Couldn’t update: unknown error.');
});

// The settings backup's key filter (src/apps/settings/web/backup-keys.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupKey, backupValues } from '../src/apps/settings/web/backup-keys.ts';

// backup.ts imports core/web/dom.ts, which reads the page's location when it loads; node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { backupNote } = await import('../src/apps/settings/web/backup.ts');

test('backupKey keeps the os.* settings and the sidebar pins', () => {
  assert.equal(backupKey('os.brightness'), true);
  assert.equal(backupKey('os.quiet'), true);
  assert.equal(backupKey('rail.pins'), true);
  assert.equal(backupKey('launcher.layout.tablet'), false);
  assert.equal(backupKey('rail.pinsX'), false);
});

test('backupKey drops tokens, keys, secrets, passwords, the sign-in and the PIN state', () => {
  assert.equal(backupKey('os.accessToken'), false);
  assert.equal(backupKey('os.apiKey'), false);
  assert.equal(backupKey('os.clientSecret'), false);
  assert.equal(backupKey('os.password'), false);
  assert.equal(backupKey('os.signinState'), false);
  assert.equal(backupKey('os.sign-in'), false);
  assert.equal(backupKey('os.pinSet'), false);
  assert.equal(backupKey('os.keySounds'), false);
});

test('backupKey drops the notification history, which is not a setting', () => {
  assert.equal(backupKey('os.notes'), false);
  assert.equal(backupKey('os.wakePaused'), false);
});

test('backupValues keeps only backup keys with short text values', () => {
  const kept = backupValues({
    'os.brightness': '0.8', 'os.dnd': '1', 'rail.pins': '["claude"]',
    'os.apiToken': 'x', 'launcher.layout.tablet': '{}', 'os.big': 'y'.repeat(2001), 'os.num': 3,
  });
  assert.deepEqual(kept, { 'os.brightness': '0.8', 'os.dnd': '1', 'rail.pins': '["claude"]' });
});

test('backupNote says the PC cannot be reached when there is no answer', () => {
  assert.equal(backupNote(null), 'Can’t reach your PC');
});

test('backupNote says not saved yet when the PC has no backup', () => {
  assert.equal(backupNote({ saved: null, values: {} }), 'Not saved yet');
});

test('backupNote gives the saved time and the setting count', () => {
  const saved = '2026-11-26T09:30:00.000Z';
  const when = new Date(saved).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  assert.equal(backupNote({ saved, values: { 'os.brightness': '0.8', 'os.dnd': '1' } }), `${when} · 2 settings`);
});

// The settings backup's key filter (src/apps/settings/web/backup-keys.ts). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { backupKey, backupValues } from '../src/apps/settings/web/backup-keys.ts';

// backup.ts imports core/web/dom.ts, which reads the page's location when it loads; node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { backupNote, restoreOutcome } = await import('../src/apps/settings/web/backup.ts');

// The server reads its backup file named by CLAUDEOS_BACKUP_FILE when it loads, so point it at a temp folder first.
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-backup-'));
process.env.CLAUDEOS_BACKUP_FILE = path.join(backupDir, 'claudeos-settings-backup.json');
const { readBackup, saveBackup } = await import('../src/apps/settings/server/backup.ts');

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

test('restoreOutcome shows the can’t-reach status and the note when the PC is down', () => {
  assert.deepEqual(restoreOutcome(-1), { msg: 'Can’t reach your PC. Try again when it’s back.', note: 'Can’t reach your PC' });
});

test('restoreOutcome shows the nothing-saved status and keeps the note when the PC has no backup', () => {
  assert.deepEqual(restoreOutcome(0), { msg: 'Nothing is saved on your PC yet. Tap Save to PC first.', note: null });
});

test('restoreOutcome leaves the note alone when settings were restored', () => {
  assert.deepEqual(restoreOutcome(3), { msg: '', note: null });
});

test('backupNote shows the PC’s read error when the backup cannot be read', () => {
  const error = 'The PC couldn’t read its settings backup.';
  assert.equal(backupNote({ ok: false, saved: null, values: {}, error }), error);
});

test('restoreOutcome says nothing was restored when the PC cannot read its backup', () => {
  assert.deepEqual(restoreOutcome(-2), { msg: 'The PC couldn’t read its settings backup, so nothing was restored.', note: null });
});

test('readBackup says not saved for a missing file and ok: false for an unreadable one', () => {
  const file = process.env.CLAUDEOS_BACKUP_FILE as string;
  try {
    assert.deepEqual(readBackup(), { ok: true, saved: null, values: {} });
    fs.writeFileSync(file, '{ "saved": ');   // invalid JSON, so the file exists but cannot be read
    assert.deepEqual(readBackup(), { ok: false, saved: null, values: {}, error: 'The PC couldn’t read its settings backup.' });
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('backupNote gives the saved time and the setting count', () => {
  const saved = '2026-11-26T09:30:00.000Z';
  const when = new Date(saved).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  assert.equal(backupNote({ saved, values: { 'os.brightness': '0.8', 'os.dnd': '1' } }), `${when} · 2 settings`);
});

test('saving a backup over an unreadable file keeps the old bytes as .corrupt', () => {
  const file = process.env.CLAUDEOS_BACKUP_FILE as string;
  fs.mkdirSync(path.dirname(file), { recursive: true });   // an earlier test removes this folder
  try {
    fs.writeFileSync(file, '{ "saved": broken');
    const res = saveBackup({ values: { 'os.quiet': '1' } });
    assert.equal(res.ok, true, 'the new backup saves');
    assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{ "saved": broken', 'the unreadable copy is kept');
    assert.deepEqual(readBackup().values, { 'os.quiet': '1' });
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.corrupt`, { force: true });
  }
});

test('a restore this tablet could not write is reported as not complete, and the page does not reload for it', () => {
  assert.equal(restoreOutcome(-3).msg, 'This tablet couldn’t save its settings, so the restore is not complete.');
  assert.equal(restoreOutcome(-3).note, null);
  const src = fs.readFileSync(new URL('../src/apps/settings/web/backup.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(failed\) \{[\s\S]*?return -3;/);
});

// The Settings backup save and read give up on a PC that does not answer, and a note read from before a save does not overwrite the
// saved note (src/apps/settings/web/backup.ts; src/apps/settings/web/index.ts paintBackupNote). The modules talk to the tablet at load,
// so this reads their source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backup = readFileSync(path.join(root, 'src/apps/settings/web/backup.ts'), 'utf8').replace(/\r\n/g, '\n');
const settings = readFileSync(path.join(root, 'src/apps/settings/web/index.ts'), 'utf8').replace(/\r\n/g, '\n');

test('the backup save and read both pass the timeout', () => {
  assert.match(backup, /const BACKUP_TIMEOUT_MS = 20e3;/);
  assert.match(backup, /postJson<SaveResult>\('\/api\/settings\/backup', \{ values: localSettings\(\) \}, BACKUP_TIMEOUT_MS\)/);
  assert.match(backup, /getJson<BackupState>\('\/api\/settings\/backup', BACKUP_TIMEOUT_MS\)/);
});

test('a note read takes the next number before it waits, and checks it before the note is written', () => {
  const start = settings.indexOf('async function paintBackupNote(');
  const body = settings.slice(start, settings.indexOf('\n}\n', start));
  assert.ok(body.indexOf('const n = ++backupSeq;') >= 0, 'the number is taken');
  assert.ok(body.indexOf('const n = ++backupSeq;') < body.indexOf('await loadSettings'), 'the number is taken before the read');
  assert.ok(body.indexOf('if (n !== backupSeq) return;') < body.indexOf("$('stBkNote')"), 'the check comes before the note is written');
});

test('a save bumps the number, so a note read from before it does not write the note', () => {
  const start = settings.indexOf('function initBackup(');
  const body = settings.slice(start, settings.indexOf('\n}\n', start));
  assert.ok(body.indexOf('backupSeq++;') > body.indexOf('await saveSettings()'), 'the bump comes after the save answers');
});

// A failed hub-sessions.json save must not throw from rememberHostSession or forgetHubSession. Run with: npm test
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// CLAUDEOS_STATE_DIR is read when paths.ts loads, so set it before the module under test is imported.
const dir = mkdtempSync(join(tmpdir(), 'host-sessions-save-'));
process.env.CLAUDEOS_STATE_DIR = dir;
const { rememberHostSession, forgetHubSession, hostSession } = await import('../src/apps/claude/server/hostsessions.ts');

// A directory where the file should be makes the rename in writeJsonFile fail on every save.
// It is made after the import, because a bad file found at load is moved aside and the save then succeeds.
mkdirSync(join(dir, 'hub-sessions.json'));

after(() => rmSync(dir, { recursive: true, force: true }));

const record = { id: 'save-fail-1', cwd: dir, title: 'Save fails', createdAt: new Date().toISOString() };

test('rememberHostSession does not throw when the save fails, and keeps the record in memory', () => {
  assert.doesNotThrow(() => rememberHostSession(record));
  assert.deepEqual(hostSession(record.id), record);
});

test('forgetHubSession does not throw when the save fails, and drops the record from memory', () => {
  rememberHostSession(record);
  assert.doesNotThrow(() => forgetHubSession(record.id));
  assert.equal(hostSession(record.id), undefined);
});

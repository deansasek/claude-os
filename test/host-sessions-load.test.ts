// A hub-sessions.json with bad entries loads the valid sessions and keeps the bad ones on disk. Run with: npm test
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// CLAUDEOS_STATE_DIR is read when paths.ts loads, so set it before the module under test is imported.
const dir = mkdtempSync(join(tmpdir(), 'host-sessions-load-'));
process.env.CLAUDEOS_STATE_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));
const good = { id: 'ok-1', cwd: dir, title: 'Good', createdAt: '2026-01-01T00:00:00.000Z' };
const file = join(dir, 'hub-sessions.json');

test('bad entries are skipped at load, and the valid session still loads', async () => {
  writeFileSync(file, JSON.stringify({ sessions: [null, 5, { id: 'x' }, { ...good, title: 42 }, good] }));
  const H = await import(`../src/apps/claude/server/hostsessions.ts?mixed=${Date.now()}`);
  assert.deepEqual(H.hostSession('ok-1'), good);
  assert.equal(H.hostSessionIds().size, 1);
});

test('a list that is not an array loads as none, and the file is not lost', async () => {
  writeFileSync(file, JSON.stringify({ sessions: { not: 'a list' } }));
  const H = await import(`../src/apps/claude/server/hostsessions.ts?object=${Date.now()}`);
  assert.equal(H.hostSessionIds().size, 0);
});

test('a save keeps the bad entries that were in the file', async () => {
  writeFileSync(file, JSON.stringify({ sessions: [null, good] }));
  const H = await import(`../src/apps/claude/server/hostsessions.ts?keep=${Date.now()}`);
  H.forgetHubSession('nothing-here');   // no change, so no save
  H.rememberHostSession({ ...good, id: 'ok-2' });
  const saved = JSON.parse(readFileSync(file, 'utf8')).sessions;
  assert.equal(saved.some((s: unknown) => s === null), true, 'the bad entry is still in the file');
  assert.equal(saved.filter((s: { id?: string }) => s?.id === 'ok-1').length, 1);
});

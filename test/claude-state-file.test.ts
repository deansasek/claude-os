// The Claude app's state file: a damaged file is set aside, a good file loads, a failed save leaves memory as it was. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

type StateModule = typeof import('../src/apps/claude/server/state.ts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-claude-state-'));
let loads = 0;

// state.ts reads its file once, when it loads, so each case loads a fresh copy aimed at its own file.
async function loadState(target: string): Promise<StateModule> {
  process.env.CLAUDEOS_CLAUDE_STATE_FILE = target;
  return await import(`../src/apps/claude/server/state.ts?load=${++loads}`) as StateModule;
}

test('a damaged file is set aside as .corrupt, the state starts empty, and a later save does not overwrite the copy', async () => {
  const file = path.join(dir, 'damaged.json');
  fs.writeFileSync(file, '{ broken');
  const s = await loadState(file);
  assert.equal(s.archivedIds().size, 0);
  assert.deepEqual(s.pinnedIn('s1'), []);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{ broken');

  assert.equal(s.setArchived('s1', true), true);
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{ broken');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).archived, ['s1']);
});

test('a good file loads its archived sessions and pins, and drops entries of the wrong type', async () => {
  const file = path.join(dir, 'good.json');
  fs.writeFileSync(file, JSON.stringify({ archived: ['a1', 7], pins: { s1: ['m1', 'm2'], s2: 'bad' } }));
  const s = await loadState(file);
  assert.deepEqual([...s.archivedIds()], ['a1']);
  assert.deepEqual(s.pinnedIn('s1'), ['m1', 'm2']);
  assert.deepEqual(s.pinnedIn('s2'), []);
  assert.equal(fs.existsSync(`${file}.corrupt`), false);
});

test('a failed save returns false and leaves the state in memory unchanged', async () => {
  const file = path.join(dir, 'blocked.json');
  const s = await loadState(file);
  assert.equal(s.setArchived('a1', true), true);

  // the file path becomes a folder, so the write cannot replace it
  fs.rmSync(file);
  fs.mkdirSync(file);
  assert.equal(s.setArchived('a2', true), false);
  assert.equal(s.setPinned('s1', 'm1', true), false);
  assert.equal(s.forgetState('a1'), false);
  assert.deepEqual([...s.archivedIds()], ['a1']);
  assert.deepEqual(s.pinnedIn('s1'), []);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('entries that cannot be read are kept in the file through a later save', async () => {
  const file = path.join(dir, 'unread.json');
  fs.writeFileSync(file, JSON.stringify({ archived: ['a1', 7], pins: { s1: ['m1'], s2: 'bad' } }));
  const s = await loadState(file);
  assert.equal(s.setArchived('a2', true), true, 'the change saves');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(stored.archived.includes(7), true, 'the unread archived entry is still in the file');
  assert.equal(stored.pins.s2, 'bad', 'the unread pin value is still in the file');
  assert.deepEqual(s.pinnedIn('s1'), ['m1']);
});

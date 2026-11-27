// Routine saves and restores on the PC run one at a time, so a change made while the routines file is missing is not
// overwritten (src/apps/routines/server/store.ts). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-routines-serial-'));
const file = path.join(dir, 'routines.json');
process.env.CLAUDEOS_ROUTINES_FILE = file;
const R = await import('../src/apps/routines/server/store.ts');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const morning = { name: 'Morning', phrases: ['morning'], steps: [{ kind: 'weather' }] };
const night = { name: 'Night', phrases: ['night'], steps: [{ kind: 'say', text: 'Night' }] };

test('two saves at once on a PC with no routines file keep both', async () => {
  fs.rmSync(file, { force: true });
  await Promise.all([R.saveRoutine(morning), R.saveRoutine(night)]);
  const names = (await R.readRoutines()).routines.map(r => r.name);
  assert.ok(names.includes('Morning'), 'Morning is kept');
  assert.ok(names.includes('Night'), 'Night is kept');
});

test('a restore that starts while a save is still reading the missing file is refused, not written over the save', async () => {
  fs.rmSync(file, { force: true });
  const [, restored] = await Promise.all([R.saveRoutine(morning), R.restoreRoutines([night])]);
  assert.equal(restored.ok, false, 'the save finished first, so the file exists and the restore is refused');
  const names = (await R.readRoutines()).routines.map(r => r.name);
  assert.ok(names.includes('Morning'), 'the saved routine is kept');
});

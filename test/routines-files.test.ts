// The routines store, run against a scratch file (never the family's routines). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-routines-'));
const file = path.join(dir, 'routines.json');
process.env.CLAUDEOS_ROUTINES_FILE = file;
const R = await import('../src/apps/routines/server/store.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

// A file with one routine, so reading never reaches for the built-in ones (they ask Home Assistant for scenes).
const seed = { routines: [{ id: 'bedtime', name: 'Bedtime', phrases: ['bedtime'], steps: [{ kind: 'say', text: 'Night' }] }] };

test('a saved file is read back with its routine', async () => {
  fs.writeFileSync(file, JSON.stringify(seed));
  const r = await R.readRoutines();
  assert.equal(r.ok, true);
  assert.deepEqual(r.routines.map(x => x.id), ['bedtime']);
});

test('saving a new routine adds it to the file, and leaves no .tmp file behind', async () => {
  const r = await R.saveRoutine({ name: 'Morning walk', phrases: ['morning walk'], steps: [{ kind: 'weather' }] });
  assert.equal(r.ok, true);
  const names = (await R.readRoutines()).routines.map(x => x.name);
  assert.ok(names.includes('Morning walk'));
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('deleting a routine removes only that one', async () => {
  const before = (await R.readRoutines()).routines.map(x => x.id);
  const target = before.find(id => id !== 'bedtime')!;
  const r = await R.deleteRoutine(target);
  assert.equal(r.ok, true);
  const after2 = (await R.readRoutines()).routines.map(x => x.id);
  assert.ok(!after2.includes(target));
  assert.ok(after2.includes('bedtime'));
});

test('a file that cannot be read is reported and left as it is', async () => {
  fs.writeFileSync(file, '{not json');
  const r = await R.readRoutines();
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json');
});

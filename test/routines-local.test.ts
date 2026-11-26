// The tablet's copy of the routines (web/local.ts) and the PC's merge rule (server/store.ts): the queued changes replay on
// the PC's newer routines, and nothing is lost. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { Routine } from '../src/apps/routines/api.ts';
import { applyOp, remapIds, type Op } from '../src/apps/routines/web/local.ts';

// The store reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-routines-local-'));
const file = path.join(dir, 'routines.json');
process.env.CLAUDEOS_ROUTINES_FILE = file;
const R = await import('../src/apps/routines/server/store.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const morning: Routine = { id: 'morning', name: 'Morning', phrases: ['morning'], steps: [{ kind: 'weather' }] };
const night: Routine = { id: 'night', name: 'Night', phrases: ['night'], steps: [{ kind: 'say', text: 'Night' }] };
const save = (routine: Record<string, unknown>): Op => ({ path: 'save', body: { routine } });

test('a change applies to a copy and gives a new routine an id the PC can keep', () => {
  const copy = [morning, night];
  const op = save({ name: 'Movie night', phrases: ['movie night'], steps: [{ kind: 'ambient' }] });
  const r = applyOp(copy, op);
  assert.equal(r.ok, true);
  assert.equal(copy.length, 2);                                  // the input is not changed
  assert.equal(r.routines.length, 3);
  const id = (op.body.routine as { id: string }).id;
  assert.match(id, /^movie-night-[a-z0-9]+$/);
  assert.equal(r.routines[2].id, id);
});

test('the PC rules hold on the tablet: no second name, no bad step, no change to a missing routine', () => {
  assert.equal(applyOp([morning], save({ name: 'morning', phrases: [], steps: [{ kind: 'weather' }] })).ok, false);
  assert.equal(applyOp([morning], save({ name: 'Bad', phrases: [], steps: [{ kind: 'timer', minutes: 0 }] })).ok, false);
  const gone = applyOp([morning], { path: 'delete', body: { id: 'nope' } });
  assert.deepEqual(gone.routines.map(r => r.id), ['morning']);
});

test('a phrase another routine already uses is refused on the tablet too', () => {
  const clash = applyOp([morning, night], save({ name: 'Early', phrases: ['morning'], steps: [{ kind: 'weather' }] }));
  assert.equal(clash.ok, false);
  assert.equal(clash.error, '“morning” already runs Morning.');
  const own = applyOp([morning, night], save({ id: 'morning', name: 'Morning', phrases: ['morning'], steps: [{ kind: 'weather' }] }));
  assert.equal(own.ok, true);
});

test('remapIds points later changes at the id the PC gave', () => {
  const queue: Op[] = [
    save({ id: 'tablet-1', name: 'Walk', phrases: [], steps: [{ kind: 'weather' }] }),
    { path: 'delete', body: { id: 'tablet-1' } },
  ];
  remapIds(queue, 'tablet-1', 'walk');
  assert.equal((queue[0].body.routine as { id: string }).id, 'walk');
  assert.equal(queue[1].body.id, 'walk');
});

test('queued changes replay on the PC over its newer routine, and none is lost', async () => {
  // The tablet copied Morning and Night, then the PC went away. The tablet changed Night, added Movie night and removed
  // Morning. Claude added Bedtime on the PC meanwhile.
  fs.writeFileSync(file, JSON.stringify({ routines: [morning, night] }));
  const queue: Op[] = [
    save({ id: 'night', name: 'Night', phrases: ['good night'], steps: [{ kind: 'say', text: 'Good night' }] }),
    save({ name: 'Movie night', phrases: ['movie night'], steps: [{ kind: 'ambient' }] }),
    { path: 'delete', body: { id: 'morning' } },
  ];
  let tablet: Routine[] = [morning, night];
  for (const op of queue) tablet = applyOp(tablet, op).routines;

  assert.equal((await R.readRoutines()).ok, true);
  await R.saveRoutine({ name: 'Bedtime', phrases: ['bedtime'], steps: [{ kind: 'weather' }] });

  // The PC gets the queue in order, through the same store calls as its routes.
  for (const op of queue) {
    const r = op.path === 'save' ? await R.saveRoutine(op.body.routine) : await R.deleteRoutine(op.body.id);
    assert.equal(r.ok, true);
  }
  const pc = (await R.readRoutines()).routines;
  const byId = new Map(pc.map(r => [r.id, r]));
  assert.equal(byId.has('morning'), false);                                  // the tablet's delete
  assert.deepEqual(byId.get('night')?.steps, [{ kind: 'say', text: 'Good night' }]);   // the tablet's edit
  assert.equal(byId.get('bedtime')?.name, 'Bedtime');                        // Claude's newer routine is kept
  const movie = tablet.find(r => r.name === 'Movie night');
  assert.ok(movie && byId.has(movie.id));                                    // the id the tablet gave is the PC's
  assert.equal(pc.length, 3);

  // A change the PC refuses (a second "Bedtime") is dropped without losing the rest.
  const refused = await R.saveRoutine({ name: 'Bedtime', phrases: ['sleep'], steps: [{ kind: 'weather' }] });
  assert.equal(refused.ok, false);
  assert.equal((await R.readRoutines()).routines.length, 3);
});

test('the tablet copy is restored only when the PC has no routines file', async () => {
  fs.rmSync(file, { force: true });
  const r = R.restoreRoutines([morning, night]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.routines.map(x => x.id), ['morning', 'night']);
  const again = R.restoreRoutines([morning]);
  assert.equal(again.ok, false);
  assert.equal((await R.readRoutines()).routines.length, 2);
});

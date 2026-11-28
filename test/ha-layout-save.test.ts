// The Home Assistant layout saves must put back the previous layout when the PC save fails.
// The page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function fnBody(name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
}

test('saveLayout keeps the previous layout and restores it in the failure branch and catch', () => {
  const body = fnBody('saveLayout');
  assert.match(body, /const prev = dash\?\.layout;/);
  assert.match(body, /else if \(dash && prev\) dash\.layout = prev;/);
  assert.match(body, /catch \{ if \(gen === layoutGen && dash && prev\) dash\.layout = prev;/);
});

test('refresh keeps the caller note when the reload fails', () => {
  const body = fnBody('refresh');
  assert.match(body, /catch \{ if \(!keepNote \|\| !note\) note = 'Can’t reach the PC right now\.'; \}/);
  const setOnHomeBody = fnBody('setOnHome');
  assert.match(setOnHomeBody, /await refresh\(note !== ''\);/);
});

test('setOnHome saves the old dashboard value first and restores it when the PC refuses or cannot be reached', () => {
  const body = fnBody('setOnHome');
  const save = body.indexOf('const before = d?.dashboard === true;');
  const change = body.indexOf('if (d) d.dashboard = on;');
  assert.notEqual(save, -1, 'setOnHome saves the old dashboard value');
  assert.notEqual(change, -1, 'setOnHome sets the new dashboard value');
  assert.ok(save < change, 'the old value is saved before the change');
  assert.match(body, /if \(!r\.ok && d\) d\.dashboard = before;/);
  assert.match(body, /catch \{ if \(gen === layoutGen && dash && prev\) dash\.layout = prev; if \(d\) d\.dashboard = before;/);
});

test('saveLayout and setOnHome assign r.layout only when r is ok and the layout is an object', () => {
  for (const name of ['saveLayout', 'setOnHome']) {
    const body = fnBody(name);
    assert.match(body, /if \(r\.ok && r\.layout && typeof r\.layout === 'object'\)/);
    assert.doesNotMatch(body, /^\s*if \(dash\) dash\.layout = r\.layout;$/m);
  }
});

// The PC side: a failed file write must not change the layout the PC serves. Runs the real layout.ts on a scratch
// state directory (CLAUDEOS_STATE_DIR is read when paths.ts loads, so it is set before the import below).
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-ha-layout-'));
process.env.CLAUDEOS_STATE_DIR = stateDir;
after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

test('a layout save that cannot be written keeps the saved layout, for the layout and the Home scenes', async () => {
  const L = await import('../src/apps/home-assistant/server/layout.ts');
  const first = L.saveLayout(false, { rooms: [{ id: 'rone', name: 'Kitchen', devices: ['light.kitchen'] }], other: [], names: {} });
  assert.equal(first.ok, true);
  const home = L.setHomeScene(false, 'scene.good_morning', true);
  assert.equal(home.ok, true);
  const saved = L.getLayout(false);

  // a directory where the layout file goes makes the rename fail
  const file = path.join(stateDir, '.ha-layout.json');
  fs.rmSync(file, { force: true });
  fs.mkdirSync(file);

  const r = L.saveLayout(false, { rooms: [{ id: 'rone', name: 'Den', devices: ['light.kitchen', 'light.living_room'] }], other: [], names: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'The PC couldn’t save the layout.');
  assert.deepEqual(r.layout, saved, 'the answer carries the saved layout, not the unsaved one');
  assert.deepEqual(L.getLayout(false), saved, 'the layout served after the failure is still the saved one');

  const scene = L.setHomeScene(false, 'scene.movie_night', true);
  assert.equal(scene.ok, false);
  assert.deepEqual(scene.home, ['scene.good_morning'], 'the Home scenes keep the saved pick');
  assert.deepEqual(L.homeScenes(false), ['scene.good_morning']);

  // taking off a scene that is not picked changes nothing, so the blocked file does not matter
  const off = L.setHomeScene(false, 'scene.movie_night', false);
  assert.equal(off.ok, true);
  assert.deepEqual(off.home, ['scene.good_morning']);
  assert.deepEqual(L.homeScenes(false), ['scene.good_morning']);
});

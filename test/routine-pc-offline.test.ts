// A routine tap says why it did not start (src/apps/routines/web/run.ts, startRoutine; src/apps/home/web/index.ts, tapRoutine).
// run.ts touches the page at load, so this reads the source of both files. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const voice = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/voice-commands.ts'), 'utf8').replace(/\r\n/g, '\n');
const run = read('routines/web/run.ts');
const routines = read('routines/web/index.ts');
const home = read('home/web/index.ts');
const between = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

test('startRoutine reports offline when the PC does not answer and no copy is recent', () => {
  const body = between(run, 'export async function startRoutine(', '/** Start a routine by id.');
  assert.match(body, /catch \{ return 'offline'; \}/);
  assert.match(body, /if \(!r\) return 'gone';/);
  assert.match(body, /if \(!r\.steps\.length\) return 'empty';/);
});

test('provideRoutines passes startRoutine\'s reason through, and runRoutine is gone', () => {
  assert.match(run, /run: id => startRoutine\(id\),/);
  assert.doesNotMatch(run, /runRoutine/);
});

test('routineCommand says why a spoken routine did not start, and keeps "gone" for Claude', () => {
  const body = between(voice, 'async function routineCommand(', '// ---------- Home Assistant scenes');
  assert.match(body, /const res = await routines\.run\(hit\.id\);/);
  assert.match(body, /if \(res === 'started'\) return \{ say: '', react: 'hop' \};/);
  assert.match(body, /if \(res === 'empty'\) return \{ say: 'That routine has no steps yet\.' \};/);
  assert.match(body, /if \(res === 'offline'\) return \{ say: 'The PC isn’t answering, so that routine can’t start\.' \};/);
  assert.match(body, /return null;   \/\/ gone: the phrase goes on to Claude as before/);
});

test('the Claude run_routine tool says the same reasons for empty and offline routines', () => {
  const body = between(read('claude/web/browser-relay.ts'), 'async function runRoutine(', '/** One browser job');
  assert.match(body, /if \(res === 'empty'\) return \{ ok: false, data: 'That routine has no steps yet\.' \};/);
  assert.match(body, /if \(res === 'offline'\) return \{ ok: false, data: 'The PC isn’t answering, so that routine can’t start\.' \};/);
});

test('the Routines app Run button says why a routine did not start, and refreshes when it is gone', () => {
  const body = between(routines, 'function runNow(): void {', '// ---------- the app ----------');
  assert.match(body, /void startRoutine\(draft\.id\)\.then\(res => \{/);
  assert.match(body, /res === 'gone'\) \{ note = 'That routine is gone\.'; void refresh\(\); return; \}/);
  assert.match(body, /res === 'empty'\) \{ note = 'That routine has no steps yet\.'; render\(\); return; \}/);
  assert.match(body, /res === 'offline'\) \{ note = 'The PC isn’t answering, so that routine can’t start\.'; render\(\); return; \}/);
  assert.match(body, /note = 'That routine couldn’t start\. Try again in a moment\.'; render\(\);/);
});

test('a Home tap on an offline PC says the PC is not answering, not that the routine is gone', () => {
  const body = between(home, 'function tapRoutine(id: string)', '\n}\n');
  assert.match(body, /res === 'gone'\) \{ say\('That routine is gone\.'\)/);
  assert.match(body, /say\('The PC isn’t answering, so that routine can’t start\.'\)/);
  assert.doesNotMatch(body.slice(0, body.indexOf("res === 'gone'")), /That routine is gone/);
});

test('the scene and lists steps report a failed read as offline, and a real timeout as late', () => {
  const scene = between(run, "case 'scene': {", "case 'timer': {");
  assert.match(scene, /\.catch\(\(\) => 'offline' as const\), deadline, null\);/);
  assert.match(scene, /if \(r === 'offline'\) return 'The PC isn’t answering, so the scene didn’t change\.';/);
  assert.match(scene, /'The scene didn’t answer in time\.'/);
  const lists = between(run, "case 'lists': {", 'const l = all.find');
  assert.match(lists, /readLists\(\)\.catch\(\(\) => 'offline' as const\), deadline, null\);/);
  assert.match(lists, /if \(all === 'offline'\) return 'The PC isn’t answering, so the list can’t be read\.';/);
  assert.match(lists, /'The lists didn’t answer in time\.'/);
});

test('refresh() clears only its own failure note on success, and keeps the Run now "gone" note', () => {
  const body = between(routines, 'async function refresh(): Promise<void> {', 'async function loadScenes(');
  assert.match(body, /if \(note === refreshNote\) note = ''; refreshNote = '';/);
  assert.match(routines, /'That routine is gone\.'/);
});

test('loadScenes records the scenes status, and its catch marks a failed read as error', () => {
  const body = between(routines, 'async function loadScenes(', 'async function save(');
  assert.match(body, /scenesWhy = r\?\.status \?\? 'error';/);
  assert.match(body, /\} catch \{ scenesWhy = 'error'; \/\* keep the last list \*\/ \}/);
});

test('pickScene says why there are no scenes: not set up, cannot be read, or none yet', () => {
  const body = between(routines, 'function pickScene(', 'function addStep(');
  assert.match(body, /scenesWhy === 'not_set_up' \? 'Home Assistant isn’t set up yet\. Set it up in the Home Assistant app first\.'/);
  assert.match(body, /scenesWhy === 'error' \? 'Your scenes can’t be read just now\. Try again in a moment\.'/);
  assert.match(body, /No scenes are on the Home screen or the Home Assistant dashboard yet\. Add one in Home Assistant first; then it can go in a routine\./);
});

test('calendar and connector reads say the PC is not answering, not that the calendar is unreachable', () => {
  const calendar = between(voice, 'export async function calendarCommand(', '// ---------- Lists:');
  const connector = between(voice, 'async function connectorCommand(', '/** The family');
  for (const body of [calendar, connector]) {
    assert.match(body, /catch \{ return \{ say: 'I can’t reach your PC right now\.' \}; \}/);
    assert.doesNotMatch(body, /reach the calendar/);
  }
});

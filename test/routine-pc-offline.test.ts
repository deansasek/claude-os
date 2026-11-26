// A routine tap says why it did not start (src/apps/routines/web/run.ts, startRoutine; src/apps/home/web/index.ts, tapRoutine).
// run.ts touches the page at load, so this reads the source of both files. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
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

test('runRoutine keeps its yes-or-no answer', () => {
  assert.match(run, /return \(await startRoutine\(id\)\) === 'started';/);
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

test('refresh() clears only its own failure note on success, and keeps the Run now "gone" note', () => {
  const body = between(routines, 'async function refresh(): Promise<void> {', 'async function loadScenes(');
  assert.match(body, /if \(note === refreshNote\) note = ''; refreshNote = '';/);
  assert.match(routines, /'That routine is gone\.'/);
});

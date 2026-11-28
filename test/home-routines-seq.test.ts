// A late older routines read does not put back deleted or renamed Home routine buttons (src/apps/home/web/index.ts
// loadRoutineActs). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function loadRoutineActs(): Promise<void> {');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('loadRoutineActs takes the next number and only the newest read sets the buttons', () => {
  assert.ok(start > 0, 'loadRoutineActs() exists');
  assert.match(src, /let routinesSeq = 0;/);
  assert.match(body, /const seq = \+\+routinesSeq;/);
  assert.match(body, /if \(seq !== routinesSeq\) return;/);
});

test('the number is checked before the buttons are compared and painted', () => {
  const guard = body.indexOf('if (seq !== routinesSeq) return;');
  assert.ok(guard > 0 && guard < body.indexOf('routineActs = next;'), 'the guard comes before routineActs is set');
});

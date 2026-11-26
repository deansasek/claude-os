// The Your Claude instructions must not open an empty editor while the PC has not answered
// (src/apps/settings/web/index.ts, loadInstructions, paintInstructions, editInstructions).
// The settings page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('editInstructions reloads when instructions are missing or failed, and does not open the editor if the reload fails', () => {
  const start = src.indexOf('async function editInstructions(): Promise<void> {');
  const body = src.slice(start, src.indexOf('Keyboard.open(', start));
  assert.match(body, /if \(!instructionsLoaded \|\| instructionsFailed \|\| instructionsReadFailed\) \{\s*await loadInstructions\(\);/);
  assert.match(body, /if \(instructionsReadFailed\) \{ confirmSheet\(INSTRUCTIONS_READ_FAILED[^\n]*\); return; \}/);
  assert.match(body, /if \(!instructionsLoaded \|\| instructionsFailed\) \{ confirmSheet\('Couldn’t reach your PC'/);
  assert.match(body, /confirmSheet\('Couldn’t reach your PC'[^\n]*\); return; \}/);
});

test('paintInstructions says the old instructions may be out of date when a later reload fails', () => {
  const start = src.indexOf('function paintInstructions(): void {');
  const body = src.slice(start, src.indexOf('async function editInstructions', start));
  assert.match(body, /instructionsLoaded\s*\?\s*\(instructionsFailed \? 'Couldn’t reach your PC, so these may be out of date\.' : 'Tap to write them\./);
});

test('paintInstructions shows the read-failed note and not the empty prompt while the PC cannot read the file', () => {
  const start = src.indexOf('function paintInstructions(): void {');
  const body = src.slice(start, src.indexOf('async function editInstructions', start));
  assert.match(body, /if \(instructionsReadFailed\) \{[\s\S]*?\$\('stInstrNote'\)\.textContent = INSTRUCTIONS_READ_FAILED;\s*return;\s*\}\s*v\.textContent = instructions \|\| 'Add instructions/);
});

test('loadInstructions takes the read error from the answer and clears the saved text', () => {
  const start = src.indexOf('async function loadInstructions');
  const body = src.slice(start, src.indexOf('function paintInstructions(): void {', start));
  assert.match(body, /instructionsReadFailed = !!d\.error;\s*instructions = d\.error \? '' : d\.text \|\| '';/);
});

test('loadInstructions sets the failed note text when the PC does not answer', () => {
  const start = src.indexOf('function paintInstructions(): void {');
  const body = src.slice(start, src.indexOf('function editInstructions', start));
  assert.match(body, /instructionsFailed \? 'Couldn’t reach your PC\. Your instructions show when it’s back\.'/);
  assert.match(src.slice(src.indexOf('async function loadInstructions'), start), /catch \{ instructionsFailed = true;/);
});

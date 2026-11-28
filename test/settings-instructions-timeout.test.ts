// The Settings "Your Claude" instructions read gives up on a PC that does not answer, and a late older read does not undo a save
// (src/apps/settings/web/index.ts loadInstructions, saveInstructions). The module talks to the tablet at load, so this reads its source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const load = slice('async function loadInstructions(');
const save = slice('async function saveInstructions(');

test('the read has a timeout, and the save is sent with one', () => {
  assert.match(src, /const INSTR_TIMEOUT_MS = 20e3;/);
  assert.match(load, /signal: AbortSignal\.timeout\(INSTR_TIMEOUT_MS\)/);
  assert.match(save, /\{ text: text\.trim\(\) \}, INSTR_TIMEOUT_MS\)/);
});

test('each read takes the next number, and both paths drop a read that is no longer the newest', () => {
  assert.match(load, /const seq = \+\+instrSeq;/);
  const guards = load.match(/if \(seq !== instrSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
  assert.ok(load.indexOf('if (seq !== instrSeq) return;') < load.indexOf('instructions = d.error'), 'the first check comes before the text is set');
});

test('a successful save drops any read still out', () => {
  assert.match(save, /instrSeq\+\+;/);
  assert.ok(save.indexOf('instrSeq++;') > save.indexOf("throw new Error('not saved')"), 'the bump comes after the save is checked');
});

test('a late older instructions save does not change the text or show a stale sheet', () => {
  assert.match(src, /let instrSaveSeq = 0;/);
  assert.match(save, /const seq = \+\+instrSaveSeq;/);
  const guards = save.match(/if \(seq !== instrSaveSeq\) return;/g) ?? [];
  assert.equal(guards.length, 2, 'the success path and the failure path both check the number');
});

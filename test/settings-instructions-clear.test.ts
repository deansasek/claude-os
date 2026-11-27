// Clearing "Your Claude" instructions: a removal that fails throws (the saved text stays), and a removal that works empties it.
// Run with: npm test
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(path.join(os.tmpdir(), 'claudeos-instr-'));
const url = new URL('../src/apps/settings/server/instructions.ts', import.meta.url).href;

test('clearing throws when the file cannot be removed, and the view shows the read failure', async () => {
  const file = path.join(dir, 'blocked');
  mkdirSync(file);                                  // a non-empty directory: rmSync without recursive cannot remove it
  writeFileSync(path.join(file, 'x.txt'), 'x');
  process.env.CLAUDEOS_INSTRUCTIONS_FILE = file;
  const mod = await import(`${url}?blocked`);
  assert.throws(() => mod.setInstructions(''));
  assert.ok(mod.instructionsView().error);
});

test('clearing a file that exists removes it and reads back as empty', async () => {
  const file = path.join(dir, 'instructions.txt');
  writeFileSync(file, 'Be brief.');
  process.env.CLAUDEOS_INSTRUCTIONS_FILE = file;
  const mod = await import(`${url}?clear`);
  assert.equal(mod.setInstructions(''), '');
  assert.equal(existsSync(file), false);
  assert.equal(mod.getInstructions(), '');
});

// Saving "Your Claude" instructions: a write that fails keeps the saved text, and a save leaves no .tmp file behind.
// Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-instr-save-'));
const FILE = path.join(dir, 'instructions.txt');
process.env.CLAUDEOS_INSTRUCTIONS_FILE = FILE;
const url = new URL('../src/apps/settings/server/instructions.ts', import.meta.url).href;
const mod = await import(`${url}?save`);

test('a save that cannot write its .tmp file keeps the saved text and leaves no .tmp', () => {
  mod.setInstructions('Old text');
  fs.mkdirSync(`${FILE}.tmp`);                       // a directory where the temp file goes: the write fails
  try {
    assert.throws(() => mod.setInstructions('New text'));
  } finally {
    fs.rmdirSync(`${FILE}.tmp`);
  }
  assert.equal(fs.readFileSync(FILE, 'utf8'), 'Old text');
  assert.equal(mod.getInstructions(), 'Old text');
  assert.equal(fs.existsSync(`${FILE}.tmp`), false);
});

test('a normal save leaves only the instructions file, with the new text', () => {
  assert.equal(mod.setInstructions('Fresh text'), 'Fresh text');
  assert.equal(fs.readFileSync(FILE, 'utf8'), 'Fresh text');
  assert.equal(fs.existsSync(`${FILE}.tmp`), false);
});

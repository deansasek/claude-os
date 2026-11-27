// "Your Claude" instructions that the PC cannot save reply with a code and the saved text, never a raw error with a path
// (src/apps/settings/server/instructions.ts saveInstructions). A directory at the temp file's path makes the write fail. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-instr-route-'));
const FILE = path.join(dir, 'instructions.txt');
process.env.CLAUDEOS_INSTRUCTIONS_FILE = FILE;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { getInstructions, saveInstructions, setInstructions } = await import('../src/apps/settings/server/instructions.ts');

test('instructions the PC cannot save reply with the old text and a code, with no path in the error', () => {
  setInstructions('Old text');
  fs.mkdirSync(`${FILE}.tmp`);   // the write fails
  try {
    const r = saveInstructions('New text');
    assert.equal(r.ok, false);
    assert.equal(r.text, 'Old text');
    assert.equal('error' in r ? r.error : '', 'save_failed');
    assert.equal(/[:\\/]/.test('error' in r ? r.error : ''), false, 'no path in the error');
  } finally {
    fs.rmdirSync(`${FILE}.tmp`);
  }
  assert.equal(getInstructions(), 'Old text');
});

test('instructions the PC can save reply ok, with the new text', () => {
  const r = saveInstructions('New text');
  assert.deepEqual(r, { ok: true, text: 'New text' });
});

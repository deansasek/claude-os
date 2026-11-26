// Profile and instructions keep their old value when the file cannot be written (src/apps/settings/server/profile.ts
// and instructions.ts). A directory at the file's path makes the write fail on any system. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import os from 'node:os';

// Temp files only: the real profile and instructions live in the hub folder and no test may touch them.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-profile-'));
const PROFILE = path.join(SCRATCH, 'profile.json');
const INSTRUCTIONS = path.join(SCRATCH, 'instructions.txt');
process.env.CLAUDEOS_PROFILE_FILE = PROFILE;
process.env.CLAUDEOS_PROFILE_PHOTO = path.join(SCRATCH, 'profile-photo.jpg');
process.env.CLAUDEOS_INSTRUCTIONS_FILE = INSTRUCTIONS;
const clean = () => { fs.rmSync(PROFILE, { force: true }); fs.rmSync(INSTRUCTIONS, { force: true }); };
clean();
const Profile = await import('../src/apps/settings/server/profile.ts');
const Instructions = await import('../src/apps/settings/server/instructions.ts');

after(() => { clean(); fs.rmSync(SCRATCH, { recursive: true, force: true }); });

// Block the file: a directory where the file should be cannot be written over.
function blockPath(file: string, run: () => void): void {
  fs.rmSync(file, { force: true });
  fs.mkdirSync(file);
  try { run(); } finally { fs.rmdirSync(file); }
}

test('a profile change that cannot be saved does not change the profile', () => {
  Profile.setProfile({ name: 'Ada' });
  assert.equal(Profile.getProfile().name, 'Ada');
  blockPath(PROFILE, () => {
    assert.throws(() => Profile.setProfile({ name: 'Grace' }));
  });
  assert.equal(Profile.getProfile().name, 'Ada');
});

test('a welcome change that cannot be saved does not change the welcome flag', () => {
  assert.equal(Profile.setWelcomeDone(false), false);
  blockPath(PROFILE, () => {
    assert.throws(() => Profile.setWelcomeDone(true));
  });
  assert.equal(Profile.welcomeDone(), false);
});

test('instructions that cannot be saved do not change the instructions', () => {
  Instructions.setInstructions('Be brief.');
  assert.equal(Instructions.getInstructions(), 'Be brief.');
  blockPath(INSTRUCTIONS, () => {
    assert.throws(() => Instructions.setInstructions('Be long.'));
  });
  assert.equal(Instructions.getInstructions(), 'Be brief.');
});

test('instructions that cannot be read are reported as an error, not as none saved, and are read again later', async () => {
  // The shared module read the file at import, when it was missing. A fresh copy reads the blocked path now.
  fs.rmSync(INSTRUCTIONS, { force: true });
  fs.mkdirSync(INSTRUCTIONS);
  try {
    const Fresh = await import(new URL('../src/apps/settings/server/instructions.ts?unreadable', import.meta.url).href);
    assert.deepEqual(Fresh.instructionsView(), { text: '', error: 'Your PC couldn’t read your saved instructions.' });
    assert.equal(Fresh.instructionsForPrompt(), '');
    fs.rmdirSync(INSTRUCTIONS);
    fs.writeFileSync(INSTRUCTIONS, 'Be brief.');
    // The next read succeeds, so the error goes away and the saved text comes back.
    assert.deepEqual(Fresh.instructionsView(), { text: 'Be brief.' });
  } finally {
    fs.rmSync(INSTRUCTIONS, { recursive: true, force: true });
  }
});

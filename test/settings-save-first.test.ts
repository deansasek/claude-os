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
    assert.deepEqual(Profile.setProfile({ name: 'Grace' }), { ok: false, error: 'save_failed' });
  });
  assert.equal(Profile.getProfile().name, 'Ada');
});

test('a welcome change that cannot be saved does not change the welcome flag', () => {
  assert.equal(Profile.setWelcomeDone(false), false);
  blockPath(PROFILE, () => {
    assert.equal(Profile.setWelcomeDone(true), false);
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
    // A new session's prompt reads the file again, without Settings opening first.
    assert.equal(Fresh.instructionsForPrompt(), "The user's instructions: Be brief.");
    // The next read succeeds, so the error goes away and the saved text comes back.
    assert.deepEqual(Fresh.instructionsView(), { text: 'Be brief.' });
  } finally {
    fs.rmSync(INSTRUCTIONS, { recursive: true, force: true });
  }
});

test('a profile photo the PC cannot delete is kept, and the removal reports an error', () => {
  Profile.savePhoto(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
  const before = Profile.getProfile().photoAt;
  assert.notEqual(before, 0);
  const photo = process.env.CLAUDEOS_PROFILE_PHOTO as string;
  fs.rmSync(photo, { force: true });
  fs.mkdirSync(photo);
  try {
    const r = Profile.removePhoto();
    assert.equal('ok' in r && r.ok, false, 'the removal reports a failure');
  } finally {
    fs.rmdirSync(photo);
  }
  assert.equal(Profile.getProfile().photoAt, before, 'the profile still shows the photo');
});

test('a profile photo that cannot be written keeps the old photo and reports an error', () => {
  const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);
  const photo = process.env.CLAUDEOS_PROFILE_PHOTO as string;
  assert.equal(Profile.savePhoto(jpeg(8))!.ok, true);
  const before = Profile.getProfile().photoAt;
  const oldBytes = fs.readFileSync(photo);
  fs.mkdirSync(`${photo}.tmp`);                      // a directory where the temp file goes: the write fails
  try {
    const r = Profile.savePhoto(jpeg(16));
    assert.deepEqual(r, { ok: false, error: 'save_failed' });
  } finally {
    fs.rmdirSync(`${photo}.tmp`);
  }
  assert.deepEqual(fs.readFileSync(photo), oldBytes, 'the old photo is unchanged');
  assert.equal(Profile.getProfile().photoAt, before, 'the profile still shows the old photo');
});

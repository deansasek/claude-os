// A profile save the PC cannot make is refused with a code, never thrown (src/apps/settings/server/profile.ts). The profile
// file sits in a folder that does not exist, so every write fails. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-profile-fail-'));
process.env.CLAUDEOS_PROFILE_FILE = path.join(dir, 'missing-dir', 'profile.json');
process.env.CLAUDEOS_PROFILE_PHOTO = path.join(dir, 'missing-dir', 'profile-photo.jpg');
const { getProfile, removePhoto, setProfile, setWelcomeDone } = await import('../src/apps/settings/server/profile.ts');

test('a profile save the PC cannot make is refused, and the profile does not change', () => {
  const before = getProfile();
  assert.deepEqual(setProfile({ name: 'Ann' }), { ok: false, error: 'save_failed' });
  assert.deepEqual(getProfile(), before);
});

test('a welcome flag the PC cannot save stays as it was', () => {
  assert.equal(setWelcomeDone(true), false);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

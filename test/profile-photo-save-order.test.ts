// A new profile photo that the PC cannot record leaves the old photo in place (src/apps/settings/server/profile.ts savePhoto).
// A directory at the profile file's path makes the profile save fail. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-photo-order-'));
const PROFILE = path.join(dir, 'profile.json');
const PHOTO = path.join(dir, 'profile-photo.jpg');
process.env.CLAUDEOS_PROFILE_FILE = PROFILE;
process.env.CLAUDEOS_PROFILE_PHOTO = PHOTO;
const P = await import('../src/apps/settings/server/profile.ts');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const jpeg = (fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, fill)]);

test('a new photo the PC cannot record keeps the old photo and its time stamp', () => {
  const a = jpeg(1), b = jpeg(2);
  assert.equal(P.savePhoto(a)!.ok, true);
  const before = P.getProfile().photoAt;
  fs.rmSync(PROFILE, { force: true });
  fs.mkdirSync(PROFILE);   // the profile cannot be saved
  try {
    assert.deepEqual(P.savePhoto(b), { ok: false, error: 'save_failed' });
  } finally {
    fs.rmdirSync(PROFILE);
  }
  assert.ok(fs.readFileSync(PHOTO).equals(a), 'the old photo is still the picture');
  assert.equal(P.getProfile().photoAt, before, 'the profile still shows the old photo');
  assert.equal(fs.existsSync(`${PHOTO}.tmp`), false, 'no temp photo is left');
});

// The ClaudeOS PIN (src/apps/settings/server/pin.ts), run against a scratch file (never the family's PIN). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

// The PIN module reads its file path when it loads, so the scratch file is set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-pin-'));
const file = path.join(dir, 'claudeos-pin.json');
process.env.CLAUDEOS_PIN_FILE = file;
const P = await import('../src/apps/settings/server/pin.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));
// every test starts with no PIN set and no wrong tries counted
beforeEach(() => fs.rmSync(file, { force: true }));

const COOLDOWN_S = 30;

test('a PIN is set, and the right one checks; a wrong one counts as a failed try', () => {
  assert.equal(P.pinStatus().set, false);
  assert.deepEqual(P.checkPin('1234'), { ok: false, error: 'no_pin', lockedFor: 0 });
  assert.equal(P.setPin('1234', '').ok, true);
  assert.equal(P.pinStatus().set, true);
  assert.equal(P.checkPin('1234').ok, true);
  assert.deepEqual(P.checkPin('9999'), { ok: false, error: 'wrong', left: 4, lockedFor: 0 });
  assert.equal(P.checkPin(1234).ok, false);   // not a string: never the PIN
});

test('a PIN must be 4 to 6 digits', () => {
  assert.equal(P.setPin('123', '').error, 'bad_pin');
  assert.equal(P.setPin('1234567', '').error, 'bad_pin');
  assert.equal(P.setPin('12a4', '').error, 'bad_pin');
  assert.equal(P.pinStatus().set, false);
});

test('five wrong tries start a cooldown, and the right PIN is refused until it ends', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  P.setPin('1234', '');
  for (let n = 1; n <= 4; n++) assert.deepEqual(P.checkPin('0000'), { ok: false, error: 'wrong', left: 5 - n, lockedFor: 0 });
  assert.deepEqual(P.checkPin('0000'), { ok: false, error: 'locked', lockedFor: COOLDOWN_S });
  assert.deepEqual(P.checkPin('1234'), { ok: false, error: 'locked', lockedFor: COOLDOWN_S });
  assert.equal(P.pinStatus().lockedFor, COOLDOWN_S);
  t.mock.timers.tick(29_999);
  assert.equal(P.checkPin('1234').error, 'locked');
  t.mock.timers.tick(1);
  assert.equal(P.checkPin('1234').ok, true);
  assert.equal(P.pinStatus().lockedFor, 0);
});

test('a right PIN clears the wrong-try count', () => {
  P.setPin('1234', '');
  P.checkPin('0000'); P.checkPin('0000');
  assert.equal(P.checkPin('1234').ok, true);
  assert.deepEqual(P.checkPin('0000'), { ok: false, error: 'wrong', left: 4, lockedFor: 0 });
});

test('changing the PIN needs the current PIN; a wrong one is refused and nothing changes', () => {
  P.setPin('1234', '');
  assert.deepEqual(P.setPin('5678', '0000'), { ok: false, error: 'wrong', left: 4, lockedFor: 0 });
  assert.equal(P.checkPin('1234').ok, true);
  assert.equal(P.setPin('5678', '1234').ok, true);
  assert.equal(P.checkPin('5678').ok, true);
  assert.equal(P.checkPin('1234').ok, false);
});

test('a missing PIN file means no PIN; a file that cannot be parsed counts as a PIN that is set, and nothing writes to it', () => {
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(P.pinStatus(), { set: false, lockedFor: 0, fingerprint: null });
  for (const garbage of ['{not json', '', 'null', '{"salt":1,"hash":"x"}']) {
    fs.writeFileSync(file, garbage);
    const before = fs.readFileSync(file);
    assert.deepEqual(P.pinStatus(), { set: true, lockedFor: 0, fingerprint: null });
    assert.equal(P.pinFingerprint(), null);
    assert.deepEqual(P.checkPin('1234'), { ok: false, error: 'save_failed', lockedFor: 0 });
    assert.deepEqual(P.setPin('5678', ''), { ok: false, error: 'save_failed', lockedFor: 0 });
    assert.deepEqual(P.removePin('1234'), { ok: false, error: 'save_failed', lockedFor: 0 });
    assert.ok(fs.readFileSync(file).equals(before), `file bytes changed for ${JSON.stringify(garbage)}`);
    assert.equal(fs.existsSync(`${file}.corrupt`), false);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  }
  fs.rmSync(file, { force: true });   // deleting the file on the PC clears the PIN again
  assert.equal(P.pinStatus().set, false);
  assert.equal(P.checkPin('1234').error, 'no_pin');
});

test('removing the PIN needs the current PIN, then the file is gone and nothing is locked', () => {
  P.setPin('1234', '');
  assert.equal(P.removePin('0000').error, 'wrong');
  assert.equal(P.pinStatus().set, true);
  assert.ok(fs.existsSync(file));
  assert.equal(P.removePin('1234').ok, true);
  assert.equal(P.pinStatus().set, false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(P.checkPin('1234').error, 'no_pin');
});

test('a cooldown that cannot be saved is reported as a save failure, not as a lock', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
  P.setPin('1234', '');
  for (let n = 1; n <= 4; n++) P.checkPin('0000');
  // a directory where the PIN file's temporary copy goes: the save fails, and the PIN file itself stays readable
  fs.mkdirSync(`${file}.tmp`);
  try {
    assert.deepEqual(P.checkPin('0000'), { ok: false, error: 'save_failed', lockedFor: 0 });
    assert.equal(P.pinStatus().lockedFor, 0, 'no cooldown was started');
  } finally {
    fs.rmSync(`${file}.tmp`, { recursive: true, force: true });
  }
});

// The Android build's signing-key guard (android/toolchain.ts). Run with: npm test
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { keystoreProblem } from '../android/toolchain.ts';

test('a missing keystore stops the build with a clear message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keystore-'));
  try {
    const msg = keystoreProblem(join(dir, 'hub.keystore'));
    assert.equal(msg, 'android/hub.keystore is missing. Restore the backup copy. A new key would make Android refuse every update.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an existing keystore lets the build go on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keystore-'));
  try {
    const ks = join(dir, 'hub.keystore');
    writeFileSync(ks, 'key');
    assert.equal(keystoreProblem(ks), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

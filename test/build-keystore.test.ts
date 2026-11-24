// The Android build's signing-key guard (android/toolchain.ts). Run with: npm test
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { keystoreProblem } from '../android/toolchain.ts';

function withDir(files: string[], body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'keystore-'));
  try {
    for (const f of files) writeFileSync(join(dir, f), 'key');
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a missing original keystore stops the build with a clear message', () => {
  withDir(['hub-new.keystore', 'hub.lineage'], (dir) => {
    assert.match(keystoreProblem(dir) ?? '', /^android\/hub\.keystore is missing\./);
  });
});

test('a missing new keystore stops the build with a clear message', () => {
  withDir(['hub.keystore', 'hub.lineage'], (dir) => {
    assert.match(keystoreProblem(dir) ?? '', /^android\/hub-new\.keystore is missing\./);
  });
});

test('a missing lineage stops the build with a clear message', () => {
  withDir(['hub.keystore', 'hub-new.keystore'], (dir) => {
    assert.match(keystoreProblem(dir) ?? '', /^android\/hub\.lineage is missing\./);
  });
});

test('both keystores and the lineage let the build go on', () => {
  withDir(['hub.keystore', 'hub-new.keystore', 'hub.lineage'], (dir) => {
    assert.equal(keystoreProblem(dir), null);
  });
});

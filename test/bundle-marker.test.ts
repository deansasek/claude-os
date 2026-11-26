// The bundle's marker: build-page.ts writes bundle.json (bundled: true) for the APK page, and keeps it out of the
// manifest, since the PC does not serve it. Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const HOST_DIR = path.resolve(import.meta.dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-marker-'));
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(HOST_DIR, 'scripts', 'build-page.ts'), out], { stdio: 'pipe' });

test('the bundle carries bundled: true, as bundle.json', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'bundle.json'), 'utf8')), { bundled: true });
});

test('the marker is not in the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) as { files: { path: string }[] };
  assert.ok(!manifest.files.some(f => f.path === '/bundle.json' || f.path === 'bundle.json'));
});

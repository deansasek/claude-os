// The APK's page assets (android/toolchain.ts): every bundle file goes under page/, and the bundle must be whole.
// Uses the bundle that scripts/build-page.ts writes into a scratch folder. Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pageAssetEntries, pageBundleProblem } from '../android/toolchain.ts';

const HUB = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-page-'));
const bundle = path.join(scratch, 'page');
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(HUB, 'scripts', 'build-page.ts'), bundle], { stdio: 'pipe' });
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8')) as { files: { path: string }[] };
const assets = new Set(pageAssetEntries(bundle).map(e => e.to));

test('the asset list has page/index.html and page/manifest.json', () => {
  assert.ok(assets.has('page/index.html'));
  assert.ok(assets.has('page/manifest.json'));
});

test('every manifest entry is an asset under page/', () => {
  assert.ok(manifest.files.length > 0);
  for (const f of manifest.files) assert.ok(assets.has(`page${f.path}`), `page${f.path} is missing from the APK assets`);
});

test('a whole bundle passes the build check', () => {
  assert.equal(pageBundleProblem(bundle), null);
});

test('a bundle without index.html stops the build with a clear message', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'no-index-'));
  fs.copyFileSync(path.join(bundle, 'manifest.json'), path.join(dir, 'manifest.json'));
  assert.match(pageBundleProblem(dir) ?? '', /^dist\/page\/index\.html is missing\./);
});

test('a manifest entry with no file stops the build with a clear message', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'partial-'));
  fs.cpSync(bundle, dir, { recursive: true });
  const gone = manifest.files.find(f => f.path !== '/index.html');
  assert.ok(gone);
  fs.rmSync(path.join(dir, gone.path));
  assert.match(pageBundleProblem(dir) ?? '', new RegExp(`^dist/page${gone.path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} is listed`));
});

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

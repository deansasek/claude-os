// The page bundle: scripts/build-page.ts writes the browser files and a manifest. Checks the manifest against the
// WEB_FILE set and the files on disk. Run with: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { servedBytes, WEB_FILE } from '../src/core/server/served.ts';

const HUB = path.resolve(import.meta.dirname, '..');
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const listFiles = (dir: string) => (fs.readdirSync(dir, { recursive: true }) as string[])
  .map(p => p.split(path.sep).join('/'))
  .filter(p => fs.statSync(path.join(dir, p)).isFile());

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'page-bundle-'));
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(HUB, 'scripts', 'build-page.ts'), out], { stdio: 'pipe' });
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) as { files: { path: string; size: number; sha256: string }[] };
const listed = new Map(manifest.files.map(f => [f.path, f]));

test('index.html is in the bundle', () => {
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.ok(listed.has('/index.html'));
});

test('the manifest lists every WEB_FILE file under src/', () => {
  const webFiles = listFiles(path.join(HUB, 'src'))
    .map(f => `/src/${f}`)
    .filter(p => WEB_FILE.test(p));
  assert.ok(webFiles.length > 0);
  for (const p of webFiles) assert.ok(listed.has(p), `${p} is missing from the manifest`);
});

test('the manifest holds no server code and only files the bundle wrote', () => {
  for (const p of listed.keys()) {
    assert.ok(!p.split('/').includes('server'), `${p} is server code`);
    assert.ok(fs.existsSync(path.join(out, p)), `${p} is listed but not written`);
  }
});

test('each manifest hash and size matches its file', () => {
  for (const f of manifest.files) {
    const file = path.join(out, f.path);
    assert.equal(fs.statSync(file).size, f.size, `size of ${f.path}`);
    assert.equal(sha256(file), f.sha256, `sha256 of ${f.path}`);
  }
});

test('a bundled file is the same bytes the server sends', () => {
  for (const f of manifest.files) {
    const source = f.path.startsWith('/src/')
      ? path.join(HUB, 'src', f.path.slice(5))
      : path.join(HUB, 'public', f.path.slice(1));
    const served = servedBytes(source);
    const bundled = fs.readFileSync(path.join(out, f.path));
    assert.ok(Buffer.from(served).equals(bundled), `${f.path} differs from what serveStatic sends`);
  }
});

after(() => fs.rmSync(out, { recursive: true, force: true }));

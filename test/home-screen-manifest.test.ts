// The Home Screen app: the web app manifest is served and names the app, the standalone display and an icon that exists. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { resolveStatic } from '../src/core/server/index.ts';

const HOST_DIR = path.resolve(import.meta.dirname, '..');

test('the manifest is served from the public folder', () => {
  assert.equal(resolveStatic('/manifest.webmanifest'), path.join(HOST_DIR, 'public', 'manifest.webmanifest'));
  assert.equal(resolveStatic('/icon.svg'), path.join(HOST_DIR, 'public', 'icon.svg'));
});

test('the manifest opens standalone at the root with the app name', () => {
  const m = JSON.parse(fs.readFileSync(path.join(HOST_DIR, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'ClaudeOS');
  assert.equal(m.short_name, 'ClaudeOS');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.length > 0);
  for (const icon of m.icons) {
    assert.ok(fs.existsSync(path.join(HOST_DIR, 'public', icon.src.replace(/^\//, ''))), `icon ${icon.src} exists`);
  }
});

test('the page links the manifest and the iPad web-app flags', () => {
  const html = fs.readFileSync(path.join(HOST_DIR, 'public', 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
});

test('the iPad home screen icon is a 180 px PNG on disk', () => {
  const file = path.join(HOST_DIR, 'public', 'apple-touch-icon.png');
  const head = fs.readFileSync(file).subarray(0, 24);
  assert.equal(head.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(head.readUInt32BE(16), 180);   // width
  assert.equal(head.readUInt32BE(20), 180);   // height
});

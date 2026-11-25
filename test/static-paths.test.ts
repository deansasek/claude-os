// Which paths the hub serves as files: the browser code only, never server code or anything outside it. Run with: npm test
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { resolveStatic } from '../src/core/server/index.ts';

const HOST_DIR = path.resolve(import.meta.dirname, '..');

test('browser code and the page are served', () => {
  assert.equal(resolveStatic('/src/main.web.ts'), path.join(HOST_DIR, 'src', 'main.web.ts'));
  assert.ok(resolveStatic('/src/core/web/dom.ts'));
  assert.ok(resolveStatic('/src/apps/claude/web/reply.ts'));
  assert.ok(resolveStatic('/src/apps/claude/view.html'));
  assert.ok(resolveStatic('/src/apps/claude/app.css'));
  assert.ok(resolveStatic('/index.html'));
});

test('server code is never served, even inside an app', () => {
  assert.equal(resolveStatic('/src/apps/claude/server/index.ts'), null);
  assert.equal(resolveStatic('/src/apps/claude/server/guard.ts'), null);
  assert.equal(resolveStatic('/src/core/server/index.ts'), null);
  assert.equal(resolveStatic('/src/core/server/paths.ts'), null);
});

test('traversal and odd paths are refused', () => {
  assert.equal(resolveStatic('/../package.json'), null);
  assert.equal(resolveStatic('/src/../package.json'), null);
  assert.equal(resolveStatic('/src/apps/../../package.json'), null);
  assert.equal(resolveStatic('/%2e%2e/package.json'), null);
  assert.equal(resolveStatic('/x\u0000.html'), null);
  assert.equal(resolveStatic('/%E0%A'), null);   // a bad escape: not a file, and no error either
});

test('files outside the browser set are not served from src', () => {
  assert.equal(resolveStatic('/src/apps/claude/manifest.json'), null);
  assert.equal(resolveStatic('/src/apps/claude/data.txt'), null);
  assert.equal(resolveStatic('/src/apps/claude/web/notes.md'), null);
});

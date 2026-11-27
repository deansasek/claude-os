// The Home critter's walk to a waiting Claude session stops when Home is left (src/apps/home/web/index.ts). Home is DOM code,
// so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the critter go opens the session only while Home is still on screen, and only one go is pending', () => {
  assert.match(src, /goT = window\.setTimeout\(\(\) => \{ goT = undefined; if \(ctx\.isVisible\(\)\) openSession\(w\.id!\); \}, 1100\);/);
  assert.match(src, /clearTimeout\(goT\);\n    goT = window/);
});

test('leaving Home cancels the critter go', () => {
  const start = src.indexOf('function onHide(): void {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.ok(start > 0, 'onHide() exists');
  assert.match(body, /clearTimeout\(goT\); goT = undefined;/);
});

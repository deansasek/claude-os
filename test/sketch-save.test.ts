// Sketch's Save to Photos sends the drawing through the photo upload route, with a drawing id and a time limit
// (src/apps/sketch/web/save.ts). The module reads the DOM, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const save = readFileSync(new URL('../src/apps/sketch/web/save.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const index = readFileSync(new URL('../src/apps/sketch/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the drawing goes to the photo upload route as a JPEG, with a drawing id and a time limit', () => {
  assert.match(save, /fetch\('\/api\/photos\/upload', \{/);
  assert.match(save, /headers: \{ 'Content-Type': 'image\/jpeg', 'X-Photo-Id': newDrawingId\(\) \}/);
  assert.match(save, /signal: AbortSignal\.timeout\(UPLOAD_TIMEOUT_MS\)/);
  assert.match(save, /const newDrawingId = \(\): string => `sk\$\{/, 'drawing ids start with sk');
});

test('the export draws the same board the screen shows, onto the card colour', () => {
  assert.match(save, /drawBoard\(g, board, w, h\);/);
  assert.match(index, /drawBoard\(g, board, canvas\.clientWidth, canvas\.clientHeight\);/);
});

test('one save runs at a time, and the Save button is wired', () => {
  assert.match(index, /if \(saving \|\| !canvas\) return;\s*const status = c\.\$\('skStatus'\);\s*\/\/[^\n]*\n\s*if \(!hasInk\(board\)\) \{ status\.textContent = 'Nothing to save yet'; return; \}\s*saving = true;/);
  assert.match(index, /if \(b\.dataset\.act === 'save'\) \{ void save\(c\); return; \}/);
});

test('save() returns before exporting when there is nothing drawn', () => {
  const src = readFileSync(new URL('../src/apps/sketch/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(src.includes("if (!hasInk(board)) { status.textContent = 'Nothing to save yet'; return; }"));
  assert.ok(src.indexOf('if (!hasInk(board))') < src.indexOf('const blob = await exportJpeg('));
});

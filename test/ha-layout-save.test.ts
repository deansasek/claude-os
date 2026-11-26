// The Home Assistant layout saves must put back the previous layout when the PC save fails.
// The page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/home-assistant/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function fnBody(name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
}

test('saveLayout keeps the previous layout and restores it in the failure branch and catch', () => {
  const body = fnBody('saveLayout');
  assert.match(body, /const prev = dash\?\.layout;/);
  assert.match(body, /else if \(dash && prev\) dash\.layout = prev;/);
  assert.match(body, /catch \{ if \(dash && prev\) dash\.layout = prev;/);
});

test('saveLayout and setOnHome assign r.layout only when r is ok and the layout is an object', () => {
  for (const name of ['saveLayout', 'setOnHome']) {
    const body = fnBody(name);
    assert.match(body, /if \(r\.ok && r\.layout && typeof r\.layout === 'object'\)/);
    assert.doesNotMatch(body, /^\s*if \(dash\) dash\.layout = r\.layout;$/m);
  }
});

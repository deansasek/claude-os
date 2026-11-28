// The converter reads a typed negative number ("−40", with the keys' minus sign) and a number ending in a point (src/apps/calculator/web/index.ts
// readoutValue). The app is DOM code, so its readout is read from the source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/calculator/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the readout reads the keys’ minus sign and drops a trailing point before it checks the number', () => {
  assert.match(src, /const text = display\(state\)\.replace\(\/−\/g, '-'\)\.replace\(\/\\\.\$\/, ''\);/);
  assert.match(src, /return \/\^-\?\\d\+\(\\\.\\d\+\)\?\$\/\.test\(text\) \? Number\(text\) : null;/);
});

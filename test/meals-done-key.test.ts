// The keyboard's Done key saves the dinner in the Meals box (src/apps/meals/web/index.ts). The page is DOM code, so this
// reads its source: the input asks for a Done key, and Enter in the box saves that night.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the dinner box asks for a Done key, and Enter in it saves that night', () => {
  const src = readFileSync(new URL('../src/apps/meals/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /<input class="mp-input" data-i="\$\{i\}" maxlength="60" enterkeyhint="done"/);
  assert.match(src, /c\.\$\('mpDays'\)\.addEventListener\('keydown', e => \{[\s\S]*?if \(e\.key !== 'Enter'\) return;[\s\S]*?void save\(c, Number\(input\.dataset\.i\)\);/);
});

// A late older Home Assistant layout reply does not undo a newer layout edit (src/apps/home-assistant/web/index.ts
// saveLayout, setOnHome). The page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/home-assistant/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const save = slice('async function saveLayout(');
const onHome = slice('async function setOnHome(');

test('each layout edit takes the next number before its POST', () => {
  assert.match(save, /const gen = \+\+layoutGen;/);
  assert.match(onHome, /const gen = \+\+layoutGen;/);
  assert.ok(save.indexOf('const gen = ++layoutGen;') < save.indexOf('postJson<HaLayoutResult>'), 'saveLayout takes the number first');
  assert.ok(onHome.indexOf('const gen = ++layoutGen;') < onHome.indexOf('postJson<HaLayoutResult>'), 'setOnHome takes the number first');
});

test('an older reply writes or rolls back the layout only while its edit is still the newest', () => {
  assert.match(save, /if \(gen === layoutGen\) \{[\s\S]*dash\.layout = r\.layout[\s\S]*dash\.layout = prev;[\s\S]*\}/);
  assert.match(onHome, /if \(gen === layoutGen\) \{[\s\S]*dash\.layout = r\.layout[\s\S]*dash\.layout = prev;[\s\S]*\}/);
  assert.match(save, /catch \{ if \(gen === layoutGen && dash && prev\) dash\.layout = prev;/);
  assert.match(onHome, /catch \{ if \(gen === layoutGen && dash && prev\) dash\.layout = prev;/);
});

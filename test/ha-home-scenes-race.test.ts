// A late older Home-screen scene reply does not overwrite a newer list (src/apps/home-assistant/web/index.ts setHomeScene).
// The page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../src/apps/home-assistant/web/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function setHomeScene(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('each toggle takes the next number before its POST', () => {
  assert.ok(start > 0, 'setHomeScene() exists');
  assert.match(src, /let homeScenesGen = 0;/);
  const take = body.indexOf('const gen = ++homeScenesGen;');
  const post = body.indexOf('postJson<HaHomeScenesResult>');
  assert.ok(take > 0 && post > take, 'the number is taken before the POST');
});

test('the Home-screen list is written only while its toggle is still the newest', () => {
  assert.match(body, /if \(dash && gen === homeScenesGen\) dash\.layout\.homeScenes = r\.home;/);
});

// A late older Radio Home or Browse read does not overwrite the newer shelves (src/apps/radio/web/index.ts loadHome,
// loadBrowse). The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/radio/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const slice = (head: string): string => {
  const start = src.indexOf(head);
  assert.ok(start > 0, `${head} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};
const home = slice('async function loadHome(');
const browse = slice('async function loadBrowse(');

test('the Home and Browse loads each take the next number', () => {
  assert.match(src, /let homeSeq = 0;/);
  assert.match(src, /let browseSeq = 0;/);
  assert.match(home, /const mine = \+\+homeSeq;/);
  assert.match(browse, /const mine = \+\+browseSeq;/);
});

test('each load drops its answer when a newer load has started, before it sets the shelves', () => {
  const homeGuard = home.indexOf('if (mine !== homeSeq) return;');
  assert.ok(homeGuard > 0 && homeGuard < home.indexOf('pcDown = [t, g, c]'), 'the Home guard comes before pcDown and the shelves');
  const browseGuard = browse.indexOf('if (mine !== browseSeq) return;');
  assert.ok(browseGuard > 0 && browseGuard < browse.indexOf('pcDown = [t, c, l]'), 'the Browse guard comes before pcDown and the lists');
});

// The calendar settings row says "Not set" when the PC cannot be reached (src/apps/calendar/web/index.ts, loadStatus,
// saveAddress, settingRows). The calendar is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/calendar/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fn = (name: string) => {
  const start = src.indexOf(`function ${name}(`);
  return src.slice(start, src.indexOf('\n}\n', start));
};

test('loadStatus sets statusFailed when the read throws and clears it on success', () => {
  const body = fn('loadStatus');
  assert.match(body, /statusFailed = true/);
  assert.match(body, /statusFailed = false/);
});

test('saveAddress clears statusFailed when the PC answers', () => {
  assert.match(fn('saveAddress'), /statusFailed = false/);
});

test('saveAddress sets addressMsg for the address row', () => {
  assert.match(fn('saveAddress'), /addressMsg = /);
});

test('settingRows reads addressMsg, not msg, in the Calendar address detail', () => {
  const body = fn('settingRows');
  assert.match(body, /detail: addressMsg \|\|/);
  assert.doesNotMatch(body, /detail: msg \|\|/);
});

test('settingRows shows the can’t-reach text when status is null and statusFailed is true', () => {
  const body = fn('settingRows');
  assert.match(body, /const unreachable = !s && statusFailed/);
  assert.match(body, /'Can’t reach the PC'/);
  assert.match(body, /'The address shows when the PC is back\.'/);
  assert.match(body, /if \(!s\?\.configured && !unreachable\)/);
});

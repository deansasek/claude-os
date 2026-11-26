// Radio's error text when the tablet cannot reach the PC. The Radio web code runs in the browser (DOM code), so these
// are source-text checks on load() and retryHtml().
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/apps/radio/web/index.ts', import.meta.url), 'utf8');

test('a list read that fails with a TypeError marks the PC as down', () => {
  const body = src.slice(src.indexOf('async function load('), src.indexOf('async function facetsOf'));
  const catchBlock = body.slice(body.indexOf('} catch (e) {'));
  assert.match(catchBlock, /pcDown = e instanceof TypeError;/);
});

test('retryHtml shows the PC text when the PC is down, and Radio Browser text otherwise', () => {
  const line = src.split('\n').find(l => l.startsWith('function retryHtml()')) ?? '';
  assert.match(line, /esc\(pcDown \? PC_DOWN : RADIO_DOWN\)/);
  assert.match(line, /data-retry="1">Try again<\/button>/);
});

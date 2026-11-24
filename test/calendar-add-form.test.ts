// The Calendar app's add-event form writes to the ClaudeOS calendar (POST local-add), never to the connector route,
// and its confirmation says ClaudeOS, not Google. Reads the page source. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const web = fs.readFileSync(path.join(ROOT, 'src', 'apps', 'calendar', 'web', 'index.ts'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'src', 'apps', 'calendar', 'view.html'), 'utf8');

const start = web.indexOf('async function addEvent');
const end = web.indexOf('// ---------- settings', start);
const addEvent = web.slice(start, end);

test('the add form posts to the ClaudeOS calendar route', () => {
  assert.ok(start >= 0 && end > start, 'addEvent is found in the web module');
  assert.match(addEvent, /\$\{API\}\/local-add`/);
});

test('the add form never posts to the connector route', () => {
  assert.doesNotMatch(addEvent, /\$\{API\}\/add[`'"?]/);
  assert.doesNotMatch(addEvent, /\/connector/);
});

test('a successful add refreshes the range and says ClaudeOS', () => {
  assert.match(addEvent, /await load\(\);/);
  assert.match(addEvent, /to ClaudeOS\./);
});

test('the confirmation says the event is added to ClaudeOS, not Google', () => {
  assert.match(html, /<h2>Add to ClaudeOS\?<\/h2>/);
  assert.match(html, /It is added to ClaudeOS, not to Google\./);
  assert.doesNotMatch(html, /added to your Google calendar|through the claude\.ai connector/);
});

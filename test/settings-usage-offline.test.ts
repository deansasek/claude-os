// Settings > Usage off the tablet must not say "Couldn't reach your PC" before the first read finishes
// (src/apps/settings/web/index.ts, loadUsage, paintUsage).
// The settings page is DOM code with no unit seam, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { stripTypeScriptTypes } = require('node:module') as { stripTypeScriptTypes: (code: string) => string };

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// Cut one top-level function out of the source, from its header to the closing brace at column 0.
function sourceOf(header: string): string {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `missing ${header}`);
  const end = src.indexOf('\n}\n', start) + 3;
  return src.slice(start, end);
}

type Box = { innerHTML: string };
type Note = { textContent: string };

// Load loadUsage and paintUsage with the same module state the page uses:
// `usage`, `usageFailed` and `section`. Off the tablet, onTablet is false.
function loadUsageHarness(getJson: (url: string) => Promise<unknown>) {
  const load = stripTypeScriptTypes(sourceOf('async function loadUsage(): Promise<void> {'));
  const paint = stripTypeScriptTypes(sourceOf('function paintUsage(): void {'));
  const code = `let usage = null;
    let usageFailed = false;
    let section = 'usage';
    const box = { innerHTML: '' };
    const note = { textContent: '' };
    const $ = (id) => (id === 'stUsageRows' ? box : note);
    const onTablet = false;
    const paintTabletUsage = () => {};
    const checkUsage = () => {};
    const USAGE_MAX_AGE = 1;
    const esc = (s) => s;
    const clock = () => '9:00';
    const whenText = () => 'Today';
    const untilText = () => '1 hour';
    ${load}
    ${paint}
    return { loadUsage, paintUsage, box, note, state: () => ({ usage, usageFailed }) };`;
  return new Function('getJson', code)(getJson) as {
    loadUsage: () => Promise<void>; paintUsage: () => void; box: Box; note: Note;
    state: () => { usage: unknown; usageFailed: boolean };
  };
}

const GOOD = { limits: { status: 'ok', updated: null, error: null, no_token: false, limits: { five_hour: { used: 40, resets_at: null }, seven_day: null }, list: [] } };

test('Usage paints Checking before the first read finishes, not Couldn’t reach', () => {
  const h = loadUsageHarness(() => new Promise(() => {}));   // read never settles
  h.paintUsage();
  assert.match(h.box.innerHTML, /Checking your usage…/);
  assert.doesNotMatch(h.box.innerHTML, /Couldn’t reach/);
  assert.equal(h.note.textContent, '');
});

test('Usage says Couldn’t reach your PC only after the read failed with no old rows', async () => {
  const h = loadUsageHarness(async () => { throw new Error('offline'); });
  await h.loadUsage();
  assert.deepEqual(h.state(), { usage: null, usageFailed: true });
  assert.match(h.box.innerHTML, /Couldn’t reach your PC to check your usage\./);
  assert.equal(h.note.textContent, '');
});

test('a good read clears the failure and paints the rows', async () => {
  const h = loadUsageHarness(async () => GOOD);
  await h.loadUsage();
  assert.equal(h.state().usageFailed, false);
  assert.match(h.box.innerHTML, /Current session/);
  assert.doesNotMatch(h.box.innerHTML, /Couldn’t reach/);
});

test('a failed read keeps the last good rows and says they may be out of date', async () => {
  let fail = false;
  const h = loadUsageHarness(async () => { if (fail) throw new Error('offline'); return GOOD; });
  await h.loadUsage();
  const goodRows = h.box.innerHTML;
  fail = true;
  await h.loadUsage();
  assert.deepEqual(h.state().usage, GOOD);   // last good usage kept, not null
  assert.equal(h.state().usageFailed, true);
  assert.equal(h.box.innerHTML, goodRows);
  assert.equal(h.note.textContent, 'Couldn’t reach your PC. Usage may be out of date.');
});

test('loadUsage never clears usage in its catch', () => {
  const body = sourceOf('async function loadUsage(): Promise<void> {');
  assert.doesNotMatch(body, /usage = null/);
  assert.match(body, /usageFailed = false;/);
  assert.match(body, /usageFailed = true;/);
});

test('usageFailed is declared at module scope next to usage', () => {
  assert.match(src, /^let usage: Usage \| null = null;\nlet usageFailed = false;/m);
});

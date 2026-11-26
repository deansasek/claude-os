// Voice "add milk, eggs and bread to the shopping list": several items only when the words have commas. Run with: npm test
// Also: a single add the PC cannot take is queued on the tablet (writeList throws queued: true), and the reply says it
// will be added when the PC is back. Only a queued write counts as waiting in the comma form.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addManyReply, matchList } from '../src/apps/lists/web/voice-match.ts';

// writeList reads the tablet's copy and the queue from localStorage and the PC from fetch: stub those browser globals
const g = globalThis as unknown as Record<string, unknown>;
const mem = new Map<string, string>();
g.location = { search: '', hash: '', pathname: '/', href: 'http://localhost/', host: 'localhost', protocol: 'http:', origin: 'http://localhost' };
g.window = g;
g.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: { style: {}, setAttribute() {} }, body: {}, createElement: () => ({ style: {} }) };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
g.dispatchEvent = () => true;
g.CustomEvent = class { type: string; init?: unknown; constructor(type: string, init?: unknown) { this.type = type; this.init = init; } };
const { caps } = await import('../src/core/web/device.ts');
const { writeList, isQueued } = await import('../src/apps/lists/web/readers.ts');
const { COPY_KEY } = await import('../src/apps/lists/web/local.ts');
const { readQueue } = await import('../src/apps/lists/web/queue.ts');

const copyJson = JSON.stringify([{ id: 'shopping', name: 'Shopping', kind: 'check', items: [] }]);
const offline = () => { g.fetch = async () => { throw new TypeError('fetch failed'); }; };
const reset = (copy: string | null) => {
  mem.clear();
  if (copy != null) mem.set(COPY_KEY, copy);
  (caps as { localState: boolean }).localState = true;
};

test('a queued add throws with queued: true, and the change is queued on the tablet', async () => {
  reset(copyJson);
  offline();
  let thrown: unknown = null;
  try { await writeList('add', { list: 'shopping', text: 'Milk' }); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof Error);
  assert.equal(isQueued(thrown), true);
  assert.equal(readQueue().length, 1);
});

test('a plain error (no tablet copy, the Nest Hub) keeps its message and has no queued flag', async () => {
  reset(null);
  offline();
  let thrown: unknown = null;
  try { await writeList('add', { list: 'shopping', text: 'Milk' }); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof Error);
  assert.equal((thrown as Error).message, 'fetch failed');
  assert.equal(isQueued(thrown), false);
  assert.equal(readQueue().length, 0);
});

test('isQueued is false for anything that is not a queued write', () => {
  assert.equal(isQueued(new Error('x')), false);
  assert.equal(isQueued(null), false);
  assert.equal(isQueued(undefined), false);
});

test('a single add that is queued gets the will-be-added wording, the same as the comma form', () => {
  assert.equal(addManyReply(['Milk'], 0, 1, 'the shopping list'), 'I can’t reach the shopping list right now. It will be added when the PC is back.');
});

test('a single add with no queued flag keeps the can’t-reach wording', () => {
  // the caller only says can't-reach when the error is not queued: this is the same reply the add branch falls back to
  const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/voice-commands.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /catch \(e\) \{\s*\/\/[^\n]*\n\s*if \(isQueued\(e\)\) return \{ say: addManyReply\(\[c\.text\], 0, 1, name\), react: 'hop' \};\s*throw e;/);
  assert.match(src, /\} catch \{ return \{ say: `I can’t reach \$\{name\} right now\.` \}; \}/);
});

test('addMany counts only queued writes as waiting', () => {
  const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/voice-commands.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /catch \(e\) \{ if \(isQueued\(e\)\) waiting\+\+; \}/);
  assert.doesNotMatch(src, /catch \{\s*waiting\+\+; \}/);
});

test('comma-separated items are each added', () => {
  assert.deepEqual(matchList('add milk, eggs and bread to the shopping list'),
    { op: 'addMany', list: 'shopping', texts: ['Milk', 'Eggs', 'Bread'] });
  assert.deepEqual(matchList('put a lemon, some rice on my to-do list'),
    { op: 'addMany', list: 'todo', texts: ['Lemon', 'Rice'] });
});

test('without a comma, "and" stays inside one item', () => {
  assert.deepEqual(matchList('add milk and eggs to the shopping list'), { op: 'add', list: 'shopping', text: 'Milk and eggs' });
  assert.deepEqual(matchList('add mac and cheese to the shopping list'), { op: 'add', list: 'shopping', text: 'Mac and cheese' });
});

test('a single item with a comma-free phrase is still one add', () => {
  assert.deepEqual(matchList('add milk to the shopping list'), { op: 'add', list: 'shopping', text: 'Milk' });
});

test('more than ten items at once is not a command; an empty item between commas is dropped', () => {
  const many = 'add a, b, c, d, e, f, g, h, i, j, k to the shopping list';
  assert.equal(matchList(many), null);
  assert.deepEqual(matchList('add milk, , eggs to the shopping list'),
    { op: 'addMany', list: 'shopping', texts: ['Milk', 'Eggs'] });
});

test('the reply says how many went, and which are waiting for the PC', () => {
  assert.equal(addManyReply(['Milk', 'Eggs', 'Bread'], 3, 0, 'the shopping list'), 'Added milk, eggs and bread to the shopping list.');
  assert.equal(addManyReply(['Milk', 'Eggs', 'Bread'], 1, 2, 'the shopping list'), 'Added 1 of 3 to the shopping list. The other 2 will be added when the PC is back.');
  assert.equal(addManyReply(['Milk', 'Eggs'], 0, 2, 'the shopping list'), 'I can’t reach the shopping list right now. The 2 items will be added when the PC is back.');
  assert.equal(addManyReply(['Milk'], 0, 1, 'the shopping list'), 'I can’t reach the shopping list right now. It will be added when the PC is back.');
});

test('tick, remove, edit and clear say the PC will get a queued change, through one helper', () => {
  const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/voice-commands.ts'), 'utf8').replace(/\r\n/g, '\n');
  // the helper: a queued write (isQueued) gets the will-get-it wording; any other error is rethrown
  assert.match(src, /function queuedReply\(e: unknown, said: string\): CommandResult \{\s*if \(!isQueued\(e\)\) throw e;\s*return \{ say: `\$\{said\} The PC will get it when it’s back\.`, react: 'hop' \};/);
  // each write sits in its own try, and its catch goes through the helper
  assert.match(src, /writeList\('tick', [^\n]*\);\s*\}\s*catch \(e\) \{ return queuedReply\(e, `Ticked off /);
  assert.match(src, /writeList\('remove', [^\n]*\);\s*\}\s*catch \(e\) \{ return queuedReply\(e, `Removed /);
  assert.match(src, /writeList\('edit', [^\n]*\);\s*\}\s*catch \(e\) \{ return queuedReply\(e, `Changed /);
  assert.match(src, /writeList\('clear-done', [^\n]*\);\s*\}\s*catch \(e\) \{ return queuedReply\(e, `Cleared the ticked items /);
});

test('other errors from those writes are rethrown to the outer catch, which says can’t reach', () => {
  const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/voice-commands.ts'), 'utf8').replace(/\r\n/g, '\n');
  // exactly the four writes go through the helper: no other catch swallows an error
  assert.equal((src.match(/catch \(e\) \{ return queuedReply\(e, /g) ?? []).length, 4);
  assert.match(src, /\} catch \{ return \{ say: `I can’t reach \$\{name\} right now\.` \}; \}/);
});

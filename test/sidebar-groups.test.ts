// The Sessions sidebar's list as data (src/apps/claude/web/sessions/sidebar-groups.ts): the native row, live sessions
// over the history, and the order of folders and rows. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { History, HistoryItem, LiveSession } from '../src/apps/claude/api.ts';

// The modules read the page's location when they load (via dom.ts); node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { archiveEmpty, emptyText, folded, folderLive, groups, isLive, stateOf, when } = await import('../src/apps/claude/web/sessions/sidebar-groups.ts');

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const HOUR = 3600;

const session = (o: Partial<LiveSession>): LiveSession => ({
  id: 's', title: 'Title', folder: 'proj', branch: null, model: null, state: 'waiting', tool: null, age: 5 * HOUR, subagents: 0,
  working: 0, tokens: 0, surface: null, open: false, hub: false, ...o,
});
const item = (id: string, title: string, at: string, o: Partial<HistoryItem> = {}): HistoryItem =>
  ({ id, title, at, messages: 2, open: false, live: false, hub: false, ...o });

test('a session is live while recent, open on the PC, or started here', () => {
  assert.equal(isLive(session({ age: 60 })), true);
  assert.equal(isLive(session({ age: 3 * HOUR })), false);
  assert.equal(isLive(session({ age: 3 * HOUR, open: true })), true);
  assert.equal(isLive(session({ age: 3 * HOUR, hub: true })), true);
});

test('the dot and the words of a session', () => {
  assert.deepEqual(stateOf(session({ state: 'thinking' }), NOW), { cls: 'busy', what: 'Thinking' });
  assert.deepEqual(stateOf(session({ state: 'waiting', age: 90 }), NOW), { cls: 'yours', what: 'Your turn · 1m' });
  assert.deepEqual(stateOf(session({ state: 'waiting', open: true }), NOW), { cls: 'yours', what: 'Your turn · on your PC' });
  assert.deepEqual(stateOf(session({ state: 'waiting', age: 3 * HOUR }), NOW), { cls: '', what: when(NOW - 3 * HOUR * 1000, NOW) });
  assert.deepEqual(stateOf(session({ state: 'stalled', age: 12 * 60 }), NOW), { cls: 'stalled', what: 'No word for 12m' });
  assert.deepEqual(stateOf(session({ state: 'stalled', open: true, age: 12 * 60 }), NOW), { cls: 'stalled', what: 'No word for 12m' });  assert.equal(when(NOW - 12 * 60e3, NOW), '12m ago');
});

test('the native row: the tablet chat is a group of its own, with its live state', () => {
  const native = session({ id: 'native', title: 'Tell me a joke', folder: 'On this tablet', state: 'waiting', age: 5, hub: true, surface: 'tablet' });
  const gs = groups([native], NOW, null, '', false);
  assert.equal(gs.length, 1);
  assert.equal(gs[0]!.name, 'On this tablet');
  assert.equal(gs[0]!.id, null);
  assert.equal(gs[0]!.rows[0]!.id, 'native');
  assert.equal(gs[0]!.rows[0]!.at, NOW - 5000);
  assert.deepEqual(stateOf(native, NOW), { cls: 'yours', what: 'Your turn · now' });
  // a search keeps the tablet chat when its title matches, and a PC session that is not in the history stays out
  const found = groups([native], NOW, null, 'JOKE', false);
  assert.deepEqual(found.map(g => g.rows.map(r => r.id)), [['native']]);
  assert.deepEqual(groups([native], NOW, null, 'weather', false), []);
  assert.deepEqual(groups([session({ id: 'p1', title: 'Tell me a joke', folder: 'proj', open: true })], NOW, null, 'joke', false), []);
  // the tablet chat is not added in the archive
  assert.deepEqual(groups([native], NOW, null, '', true), []);
});

test('a live session lays over the history: its title and time win, the history keeps the rest', () => {
  const hist: History = { q: '', total: 1, archived: 0, groups: [{ id: 'f1', name: 'proj', count: 1, latest: '2026-11-23T08:00:00.000Z', more: false,
    items: [item('s1', 'Old title', '2026-11-23T08:00:00.000Z', { messages: 4 })] }] };
  const live = [session({ id: 's1', title: 'New title', folder: 'proj', folderId: 'f1', state: 'thinking', age: 60 })];
  const gs = groups(live, NOW, hist, '', false);
  assert.equal(gs.length, 1);
  assert.equal(gs[0]!.rows.length, 1);
  const row = gs[0]!.rows[0]!;
  assert.equal(row.title, 'New title');
  assert.equal(row.at, NOW - 60e3);
  assert.ok(row.live && row.item);
  assert.deepEqual(stateOf(live[0]!, NOW), { cls: 'busy', what: 'Thinking' });
  // with no live entry, the history's title and time stand
  const old = groups([], NOW, hist, '', false)[0]!.rows[0]!;
  assert.equal(old.title, 'Old title');
  assert.equal(old.at, Date.parse('2026-11-23T08:00:00.000Z'));
  assert.equal(old.live, null);
  // a live session the history has not listed joins its folder by the folder id, and sorts by its time
  const late = groups([session({ id: 's9', title: 'Late', folder: 'proj', folderId: 'f1', age: 10 })], NOW, hist, '', false);
  assert.equal(late.length, 1);
  assert.deepEqual(late[0]!.rows.map(r => r.id), ['s9', 's1']);
  assert.equal(late[0]!.count, 2);   // the history's one, and the live one added to it
});

test('folders go by their newest session, and rows by their time, newest first', () => {
  const hist: History = { q: '', total: 3, archived: 0, groups: [
    { id: 'a', name: 'Older folder', count: 1, latest: '2026-11-20T10:00:00.000Z', more: false, items: [item('a1', 'A1', '2026-11-20T10:00:00.000Z')] },
    { id: 'b', name: 'Newer folder', count: 2, latest: '2026-11-23T09:00:00.000Z', more: true,
      items: [item('b1', 'B1', '2026-11-22T09:00:00.000Z'), item('b2', 'B2', '2026-11-23T09:00:00.000Z')] },
  ] };
  const gs = groups([], NOW, hist, '', false);
  assert.deepEqual(gs.map(g => g.name), ['Newer folder', 'Older folder']);
  assert.deepEqual(gs[0]!.rows.map(r => r.id), ['b2', 'b1']);
  assert.equal(gs[0]!.more, true);
  assert.equal(gs[0]!.count, 2);
  // a live folder the history does not know is placed by its newest session
  const extra = groups([session({ id: 'x1', title: 'X', folder: 'Scratch', age: 60 })], NOW, hist, '', false);
  assert.deepEqual(extra.map(g => g.name), ['Scratch', 'Newer folder', 'Older folder']);
});

test('a search shows only what the history matched: live sessions the history lacks stay out', () => {
  const live = [session({ id: 'z', folder: 'proj', age: 5 })];
  assert.deepEqual(groups(live, NOW, null, 'x', false), []);
  assert.equal(groups(live, NOW, null, '', false).length, 1);
});

test('a folder header counts its working and waiting sessions', () => {
  const sessions = [
    session({ id: 'a', folder: 'proj', state: 'thinking', age: 10 }),
    session({ id: 'b', folder: 'proj', state: 'tool', tool: 'Bash', age: 20 }),
    session({ id: 'c', folder: 'proj', state: 'waiting', age: 30 }),
    session({ id: 'd', folder: 'proj', state: 'waiting', age: 40 }),
    session({ id: 'e', folder: 'proj', state: 'waiting', age: 5 * HOUR }),   // not live: not counted
  ];
  const [g] = groups(sessions, NOW, null, '', false);
  assert.equal(folderLive(g!), '2 working · 2 waiting');
  assert.equal(folderLive(groups([session({ id: 'q', folder: 'quiet', state: 'waiting', age: 5 * HOUR })], NOW, null, '', false)[0]!), '');
  assert.equal(folderLive(groups([session({ id: 'w', folder: 'only', state: 'thinking', age: 10 })], NOW, null, '', false)[0]!), '1 working');
});

test('a folder folds by its id, and an older choice by name still applies', () => {
  const hist: History = { q: '', total: 1, archived: 0, groups: [{ id: 'f1', name: 'proj', count: 1, latest: '2026-11-23T08:00:00.000Z', more: false,
    items: [item('s1', 'Old title', '2026-11-23T08:00:00.000Z', { messages: 4 })] }] };
  const [g] = groups([], NOW, hist, '', false);
  assert.equal(g!.key, 'f1');
  assert.equal(folded(new Map([['proj', true]]), g!, false), true);   // an older name-keyed choice
  assert.equal(folded(new Map([['f1', false], ['proj', true]]), g!, true), false);   // the id's own choice wins
  assert.equal(folded(new Map(), g!, true), true);   // no choice: quiet folders start folded
  assert.equal(folded(new Map(), g!, false), false);
});

test('an empty sessions list says why it is empty', () => {
  assert.equal(emptyText(true), 'Can’t reach your PC');
  assert.equal(emptyText(false), 'No sessions yet');
});

test('an empty archive shows a failed fetch, not Loading', () => {
  assert.deepEqual(archiveEmpty(true, false), { head: 'Can’t reach your PC.', tip: '' });
  assert.deepEqual(archiveEmpty(true, true), { head: 'Can’t reach your PC.', tip: '' });
  assert.deepEqual(archiveEmpty(false, true).head, 'Nothing archived.');
  assert.deepEqual(archiveEmpty(false, false), { head: 'Loading…', tip: '' });
});

// The notification shade's grouping rules (src/core/web/notes-group.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appLabel, groupNotices, nextNoticeAt, parseMutedApps, toggleMutedApp, withoutNotice } from '../src/core/web/notes-group.ts';

const list = [
  { app: 'claude', title: 'Done', at: 500 },
  { app: 'timer', title: 'Timer', at: 400 },
  { app: 'claude', title: 'Needs OK', at: 300 },
  { title: 'Plain', at: 200 },
];

test('groupNotices groups by app, newest group first, and keeps each group newest first', () => {
  const groups = groupNotices(list);
  assert.deepEqual(groups.map(g => g.app), ['claude', 'timer', '']);
  assert.deepEqual(groups[0].items.map(n => n.title), ['Done', 'Needs OK']);
  assert.equal(groups[0].latest, 500);
  assert.equal(groups[2].items.length, 1);
});

test('groupNotices returns nothing for an empty list', () => {
  assert.deepEqual(groupNotices([]), []);
});

test('withoutNotice drops only the notice that arrived at that time', () => {
  assert.deepEqual(withoutNotice(list, 400).map(n => n.title), ['Done', 'Needs OK', 'Plain']);
  assert.equal(withoutNotice(list, 999).length, list.length);
});

test('nextNoticeAt gives now for an empty list', () => {
  assert.equal(nextNoticeAt([], 1000), 1000);
});

test('nextNoticeAt steps one millisecond past a notice sent at the same time', () => {
  assert.equal(nextNoticeAt([{ at: 1000 }], 1000), 1001);
});

test('nextNoticeAt keeps a future newest time and steps one past it', () => {
  assert.equal(nextNoticeAt([{ at: 1200 }], 1000), 1201);
});

test('withoutNotice removes only one of two notices sent in the same millisecond', () => {
  const first = { title: 'Event A', at: 1000 };
  const second = { title: 'Event B', at: nextNoticeAt([first], 1000) };
  const both = [second, first];
  assert.deepEqual(withoutNotice(both, second.at).map(n => n.title), ['Event A']);
});

test('parseMutedApps reads a JSON list of app ids and ignores anything else', () => {
  assert.deepEqual(parseMutedApps('["claude","timer","claude"]'), ['claude', 'timer']);
  assert.deepEqual(parseMutedApps('{"a":1}'), []);
  assert.deepEqual(parseMutedApps('not json'), []);
  assert.deepEqual(parseMutedApps(null), []);
  assert.deepEqual(parseMutedApps('[1,"",null,"photos"]'), ['photos']);
});

test('toggleMutedApp mutes an app, then unmutes it', () => {
  const once = toggleMutedApp([], 'timer');
  assert.deepEqual(once, ['timer']);
  assert.deepEqual(toggleMutedApp(once, 'timer'), []);
});

test('appLabel makes a readable heading from an app id', () => {
  assert.equal(appLabel('home-assistant'), 'Home assistant');
  assert.equal(appLabel('claude'), 'Claude');
  assert.equal(appLabel(''), 'Other');
});

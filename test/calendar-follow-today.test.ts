// The Calendar moves on to the new day when it opens after midnight, unless the user moved the view (src/apps/calendar/web/follow-today.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followedAnchor } from '../src/apps/calendar/web/follow-today.ts';

const day = (d: number) => new Date(2026, 10, d, 9, 30);   // 25 Nov 2026 is the test's "yesterday"

test('a view still on yesterday moves to the new day when it opens', () => {
  const next = followedAnchor(new Date(2026, 10, 25), new Date(2026, 10, 25), day(26));
  assert.equal(next.getDate(), 26);
  assert.equal(next.getHours(), 0);
});

test('a view the user moved to another day stays where it is', () => {
  const moved = new Date(2026, 11, 3);
  assert.equal(followedAnchor(moved, new Date(2026, 10, 25), day(26)), moved);
});

test('a view on today stays on today when the day has not changed', () => {
  const today = new Date(2026, 10, 25);
  assert.equal(followedAnchor(today, today, day(25)).getTime(), today.getTime());
});

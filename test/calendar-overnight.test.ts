// An event that runs past midnight shows its real start on the day it begins, and midnight on the day it runs on into
// (src/apps/calendar/web/shown-start.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shownStart } from '../src/apps/calendar/web/shown-start.ts';

const friday = new Date(2026, 10, 27).getTime();
const saturday = new Date(2026, 10, 28).getTime();
const late = { start: new Date(2026, 10, 27, 22, 0).getTime(), allDay: false };

test('an overnight event keeps its real start on the day it begins', () => {
  assert.equal(shownStart(late, friday), late.start);
});

test('an overnight event starts at midnight on the day it runs on into', () => {
  assert.equal(shownStart(late, saturday), saturday);
});

test('an all-day event keeps its start on every day', () => {
  const allDay = { start: friday, allDay: true };
  assert.equal(shownStart(allDay, saturday), friday);
});

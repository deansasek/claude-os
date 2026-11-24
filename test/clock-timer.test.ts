// The Clock timers as the other screens read them (src/core/web/clock-timer.ts): the list, the one-timer migration,
// the soonest running timer and its countdown. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockTimerText, parseClockTimers, readClockTimers, runningLeftMs, type ClockTimer } from '../src/core/web/clock-timer.ts';

const NOW = 1_000_000;
const t = (id: string, end: number | null, left: number | null = null, dur = 300_000): ClockTimer => ({ id, name: id, dur, end, left });

test('a list is read as it is stored, and nothing is migrated', () => {
  const list = JSON.stringify([t('a', NOW + 1000)]);
  assert.deepEqual(parseClockTimers(list, null), { timers: [t('a', NOW + 1000)], migrate: false, draft: null });
  assert.deepEqual(parseClockTimers(null, null), { timers: [], migrate: false, draft: null });
  assert.deepEqual(parseClockTimers('not json', 'not json'), { timers: [], migrate: false, draft: null });
});

test('a single timer from the earlier build becomes the first in the list (migrate: true)', () => {
  const legacy = JSON.stringify({ dur: 300_000, end: NOW + 60_000, left: null, label: 'pasta' });
  const r = parseClockTimers(null, legacy);
  assert.equal(r.migrate, true);
  assert.deepEqual(r.timers, [{ id: 'timer', name: 'pasta', dur: 300_000, end: NOW + 60_000, left: null }]);
});

test('a legacy timer without a label gets the default name; a list wins over an old key', () => {
  const r = parseClockTimers(null, JSON.stringify({ dur: 60_000, end: null, left: 30_000 }));
  assert.equal(r.timers[0].name, 'Timer 1');
  assert.equal(r.timers[0].left, 30_000);
  const both = parseClockTimers(JSON.stringify([t('x', null)]), JSON.stringify({ dur: 60_000, end: null, left: null }));
  assert.equal(both.migrate, false);
  assert.deepEqual(both.timers.map(x => x.id), ['x']);
});

test('an idle earlier timer is not listed: its length comes back as the draft, and the old key goes', () => {
  const idle = parseClockTimers(null, JSON.stringify({ dur: 240_000, end: null, left: null, label: 'pasta' }));
  assert.deepEqual(idle, { timers: [], migrate: true, draft: 240_000 });
  const unusable = parseClockTimers(null, JSON.stringify({ dur: 500, end: null, left: null }));
  assert.deepEqual(unusable, { timers: [], migrate: false, draft: null });
});

test('readClockTimers falls back to the old key when the list is not saved yet', () => {
  const store: Record<string, string> = { 'clock.timer': JSON.stringify({ dur: 60_000, end: NOW + 5000, left: null }) };
  const timers = readClockTimers(k => store[k] ?? null);
  assert.equal(timers.length, 1);
  assert.equal(runningLeftMs(timers, NOW), 5000);
});

test('the soonest running timer gives the countdown; paused and ended timers are skipped', () => {
  const list = [t('late', NOW + 120_000), t('soon', NOW + 45_000), t('paused', null, 9_000), t('over', NOW - 1)];
  assert.equal(runningLeftMs(list, NOW), 45_000);
  assert.equal(runningLeftMs([t('paused', null, 9_000)], NOW), null);
  assert.equal(runningLeftMs([], NOW), null);
});

test('the countdown text rounds up to the second and shows hours from an hour up', () => {
  assert.equal(clockTimerText([t('a', NOW + 299_001)], NOW), '5:00');
  assert.equal(clockTimerText([t('a', NOW + 59_000)], NOW), '0:59');
  assert.equal(clockTimerText([t('a', NOW + 3_899_000)], NOW), '1:04:59');
  assert.equal(clockTimerText([], NOW), null);
});

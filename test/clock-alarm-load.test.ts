// The Clock app's saved alarm list: a bad field leaves out only its own alarm. Pure (alarm-load.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAlarmList } from '../src/apps/clock/web/alarm-load.ts';

const ids = () => 'new1';

test('an alarm with an hour or minute out of range is left out', () => {
  const out = readAlarmList([{ id: 'a', h: 25, m: 0 }, { id: 'b', h: 7, m: 75 }, { id: 'c', h: 7.5, m: 0 }, { id: 'd', h: 6, m: 30, on: true }], ids);
  assert.deepEqual(out.map(x => x.id), ['d']);
});

test('a day list keeps its valid days, and a list with none is left out', () => {
  const out = readAlarmList([{ id: 'a', h: 6, m: 0, days: [1, 'mon', 9, 3] }, { id: 'b', h: 6, m: 0, days: ['mon'] }], ids);
  assert.deepEqual(out.map(x => [x.id, x.days]), [['a', [1, 3]]]);
});

test('a snooze that is not a number reads as none', () => {
  assert.equal(readAlarmList([{ id: 'a', h: 6, m: 0, snooze: '12:00' }], ids)[0].snooze, null);
});

test('a missing id gets a new one, and the label is trimmed and cut', () => {
  const [a] = readAlarmList([{ h: 6, m: 0, label: `  ${'x'.repeat(90)}  ` }], ids);
  assert.equal(a.id, 'new1');
  assert.equal(a.label?.length, 80);
});

test('a good alarm keeps its fields, and claude and fired come through', () => {
  const [a] = readAlarmList([{ id: 'a', h: 6, m: 30, on: true, days: [0, 6], snooze: null, fired: '2026-11-26', claude: true }], ids);
  assert.deepEqual(a, { id: 'a', h: 6, m: 30, on: true, days: [0, 6], snooze: null, fired: '2026-11-26', claude: true });
});

test('a value that is not a list reads as no alarms', () => {
  assert.deepEqual(readAlarmList({ h: 6, m: 0 }, ids), []);
  assert.deepEqual(readAlarmList(null, ids), []);
});

test('an alarm whose id repeats an earlier alarm gets its own id, and both are kept', () => {
  const out = readAlarmList([{ id: 'a', h: 6, m: 0 }, { id: 'a', h: 7, m: 0 }], ids);
  assert.deepEqual(out.map(x => [x.id, x.h]), [['a', 6], ['new1', 7]]);
});

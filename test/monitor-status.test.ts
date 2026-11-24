// The System monitor page's status words (src/apps/settings/web/monitor.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monitorLines, uptimeText } from '../src/apps/settings/web/monitor.ts';

test('uptimeText says hours and minutes, minutes, or under a minute', () => {
  assert.equal(uptimeText(7500), '2 h 5 min');
  assert.equal(uptimeText(300), '5 min');
  assert.equal(uptimeText(42), 'under a minute');
  assert.equal(uptimeText(-5), 'under a minute');
});

test('monitorLines reports a running hub, a connected PC, and the open and failed apps', () => {
  const l = monitorLines({ uptimeSeconds: 3600, pcReachable: true, openNames: ['Claude', 'Photos'], failedNames: [] });
  assert.deepEqual(l, { uptime: 'Running for 1 h 0 min', pc: 'Connected', open: '2 open: Claude, Photos', failed: 'No apps failed to start' });
});

test('monitorLines says what is down', () => {
  const l = monitorLines({ uptimeSeconds: null, pcReachable: false, openNames: [], failedNames: ['Weather'] });
  assert.equal(l.uptime, 'Not reachable right now');
  assert.equal(l.pc, 'Can’t reach the PC');
  assert.equal(l.open, 'No apps open');
  assert.equal(l.failed, '1 didn’t start: Weather');
});

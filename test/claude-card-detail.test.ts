// The approval cards for the ClaudeOS tools show plain details, not raw JSON (src/apps/claude/server/describe.ts).
// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askFor, describeTool } from '../src/apps/claude/server/describe.ts';

test('a timer card says its minutes and label, not the raw JSON', () => {
  assert.equal(askFor('mcp__claudeos_tablet__set_timer', { minutes: 10, label: 'pasta' }).detail, '10 minutes (pasta)');
  assert.equal(askFor('mcp__claudeos_tablet__set_timer', { minutes: 10 }).detail, '10 minutes');
});

test('an alarm card shows its time, and a forecast card its days', () => {
  assert.equal(askFor('mcp__claudeos_tablet__set_alarm', { time: '07:00', days: [1, 2, 3] }).detail, '07:00');
  assert.equal(askFor('mcp__claudeos_weather__weather_forecast', { days: 7 }).detail, '7 days');
});

test('a ClaudeOS tool with nothing to show has an empty detail, not {}', () => {
  assert.equal(askFor('mcp__claudeos_tablet__tablet_status', {}).detail, '');
  assert.equal(describeTool('mcp__claudeos_tablet__clock_status', {}).detail, '');
});

test('other tools keep their JSON detail', () => {
  assert.equal(askFor('SomeOtherTool', { a: 1 }).detail, '{"a":1}');
});

test('a Home Assistant card names the device and the service, and the scene', () => {
  assert.equal(askFor('mcp__claudeos_ha__ha_call_service', { domain: 'light', service: 'turn_on', entity_id: 'light.kitchen' }).detail, 'light.turn_on on light.kitchen');
  assert.equal(askFor('mcp__claudeos_ha__ha_call_service', { domain: 'climate', service: 'set_temperature', entity_id: 'climate.hall', temperature: 21 }).detail, 'climate.set_temperature on climate.hall, 21°');
  assert.equal(askFor('mcp__claudeos_ha__ha_activate_scene', { scene: 'Movie night' }).detail, 'Movie night');
});

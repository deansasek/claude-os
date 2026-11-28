// The ha_list_entities rows carry each device's unit and device class (src/apps/home-assistant/server/tools.ts entityRow). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// ha.ts reads its saved config when it loads, so point it at a scratch file first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-ha-row-'));
process.env.CLAUDEOS_HA_CONFIG = path.join(dir, 'ha-config.json');
const { entityRow } = await import('../src/apps/home-assistant/server/tools.ts');

test('a sensor row says its unit and what it measures', () => {
  const row = entityRow({ entity_id: 'sensor.outdoor_temperature', name: 'Outside', domain: 'sensor', state: '8.5', unit: '°C', deviceClass: 'temperature' });
  assert.equal(row.unit, '°C');
  assert.equal(row.device_class, 'temperature');
});

test('a door sensor row says it is a door, and a row with no unit leaves it out', () => {
  const door = entityRow({ entity_id: 'binary_sensor.front_door', name: 'Front door', domain: 'binary_sensor', state: 'off', deviceClass: 'door' });
  assert.equal(door.device_class, 'door');
  assert.ok(!('unit' in door));
});

test('a thermostat row keeps its temperatures and its unit', () => {
  const row = entityRow({ entity_id: 'climate.thermostat', name: 'Thermostat', domain: 'climate', state: 'heat', current: 21, target: 22, unit: '°F' });
  assert.equal(row.current_temperature, 21);
  assert.equal(row.target_temperature, 22);
  assert.equal(row.unit, '°F');
});

// A climate entity's unit label comes from Home Assistant only (src/apps/home-assistant/server/ha.ts toEntity). Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// ha.ts reads its saved config when it loads, so point it at a scratch file first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeos-ha-unit-'));
process.env.CLAUDEOS_HA_CONFIG = path.join(dir, 'ha-config.json');
const { toEntity } = await import('../src/apps/home-assistant/server/ha.ts');

test('a thermostat with no temperature_unit gets no unit, not a made-up °C', () => {
  const e = toEntity({ entity_id: 'climate.hall', state: 'heat', attributes: { friendly_name: 'Hall', current_temperature: 19, temperature: 21 } });
  assert.ok(e);
  assert.equal(e.target, 21);
  assert.equal(e.unit, undefined);
});

test('a thermostat keeps the unit Home Assistant sends', () => {
  const e = toEntity({ entity_id: 'climate.hall', state: 'heat', attributes: { temperature: 70, temperature_unit: '°F' } });
  assert.ok(e);
  assert.equal(e.unit, '°F');
});

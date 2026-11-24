// The air quality label and air lines on the Weather screen. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aqiLabel, airLine, pollenLine } from '../src/apps/weather/web/air.ts';

test('an AQI number becomes a plain label', () => {
  assert.equal(aqiLabel(0), 'Good');
  assert.equal(aqiLabel(50), 'Good');
  assert.equal(aqiLabel(51), 'Moderate');
  assert.equal(aqiLabel(100), 'Moderate');
  assert.equal(aqiLabel(101), 'Unhealthy for sensitive groups');
  assert.equal(aqiLabel(151), 'Unhealthy');
  assert.equal(aqiLabel(201), 'Very unhealthy');
  assert.equal(aqiLabel(301), 'Hazardous');
  assert.equal(aqiLabel(NaN), '');
});

test('the air line shows the AQI and its label, or nothing without a value', () => {
  assert.equal(airLine({ aqi: 42, pollen: [] }), 'Air quality 42 · Good');
  assert.equal(airLine({ aqi: null, pollen: [] }), '');
  assert.equal(airLine(null), '');
});

test('the pollen line lists only the types with values', () => {
  assert.equal(pollenLine({ aqi: 10, pollen: [{ name: 'grass', value: 12.4 }, { name: 'birch', value: 0 }] }),
    'Pollen: grass 12 · birch 0 grains/m³');
  assert.equal(pollenLine({ aqi: 10, pollen: [] }), '');
  assert.equal(pollenLine(null), '');
});

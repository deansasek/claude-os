// Temperature questions by voice (src/core/web/voice-weather.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { temperatureDay, weatherTrouble } from '../src/core/web/voice-weather.ts';

test('a question about the temperature now is about today', () => {
  assert.equal(temperatureDay("what's the temperature"), 0);
  assert.equal(temperatureDay('how cold is it outside'), 0);
  assert.equal(temperatureDay('is it hot outside'), 0);
  assert.equal(temperatureDay('is it cold'), 0);
  assert.equal(temperatureDay('is it chilly'), 0);
  assert.equal(temperatureDay('is it going to be cold today'), 0);
  assert.equal(temperatureDay('is it going to be hot'), 0);
  assert.equal(temperatureDay('how warm will it be today'), 0);
  assert.equal(temperatureDay('is it going to be cold tomorrow'), 1);
  assert.equal(temperatureDay('do i need a jacket'), 0);
});

test('a question about the temperature tomorrow is about tomorrow', () => {
  assert.equal(temperatureDay("what's the temperature tomorrow"), 1);
  assert.equal(temperatureDay('do i need a coat tomorrow'), 1);
});

test('anything else is not a temperature question', () => {
  assert.equal(temperatureDay("what's the weather"), null);
  assert.equal(temperatureDay('what time is it'), null);
  assert.equal(temperatureDay('is it hot in my coffee'), null);
});

test('no answer from the PC says the PC is not answering', () => {
  assert.deepEqual(weatherTrouble(null), { say: 'The PC isn’t answering, so I can’t get the weather.' });
});

test('a city the forecast cannot find is named, and the Weather app opens', () => {
  assert.deepEqual(weatherTrouble({ status: 'not_found', city: 'Springfeld' }), {
    say: 'Weather can’t find Springfeld. Pick your city again in the Weather app.',
    app: 'weather',
  });
});

test('a not-found answer with no city still opens the Weather app', () => {
  assert.deepEqual(weatherTrouble({ status: 'not_found' }), { say: 'Weather can’t find that city.', app: 'weather' });
});

test('a failed forecast service says so', () => {
  assert.deepEqual(weatherTrouble({ status: 'error' }), { say: 'The forecast service isn’t answering right now.' });
});

test('any other status leaves the reply to the caller', () => {
  assert.equal(weatherTrouble({ status: 'ok' }), null);
  assert.equal(weatherTrouble({ status: 'no_location' }), null);
});

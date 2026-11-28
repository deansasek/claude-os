// A snow shower is said as "snowy", so a weather sentence reads correctly (src/core/web/voice-commands.ts sky()).
// sky() is not exported, so the mapping is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('snow showers (WMO 85 and 86) are said as snowy, an adjective like the other sky words', () => {
  assert.ok(voice.includes("if (code <= 86) return 'snowy';"));
  assert.equal(voice.includes("return 'snow showers';"), false);
});

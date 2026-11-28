// \"Minimum brightness\" sets the lowest screen level, as \"full brightness\" sets the highest (src/core/web/voice-commands.ts).
// The phrase is in the command handler, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the lowest brightness phrases set the lowest step, and full brightness still sets the highest', () => {
  assert.ok(voice.includes('if (/^(?:minimum|min|lowest) brightness$|^(?:turn )?(?:the )?brightness all the way down$/.test(t)) return brightness(0);'));
  assert.ok(voice.includes('if (/^(?:full|max|maximum) brightness$/.test(t)) return brightness(1);'));
});

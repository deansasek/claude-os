// "Full volume" sets the volume to 100 percent (src/core/web/voice-commands.ts, the sound block). The command handler needs the
// browser, so it is read as source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('full, max and maximum volume, and turn the volume all the way up, set the volume to full', () => {
  assert.match(voice, /if \(\/\^\(\?:full\|max\|maximum\) volume\$\|\^\(\?:turn \)\?\(\?:the \)\?volume all the way up\$\/\.test\(t\)\) return volume\(1\);/);
});

test('the full-volume phrase is checked after the up phrases and before the number form', () => {
  const at = voice.indexOf('return volume(1);');
  assert.ok(at > voice.indexOf("return volume('up');") && at < voice.indexOf('(?:set )?(?:the )?volume (?:to )?(\\d{1,3})'));
});

// A routine's phrase said while that routine runs says so, rather than starting it again (src/core/web/voice-commands.ts,
// provided by src/apps/routines/web/run.ts). Both files need the browser, so this reads their source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const voice = readFileSync(new URL('../src/core/web/voice-commands.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const run = readFileSync(new URL('../src/apps/routines/web/run.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the routines provider says which routine runs', () => {
  assert.match(run, /running: \(\) => runState\(\)\?\.id \?\? null,/);
});

test('a phrase for the running routine says it is already running before it starts it again', () => {
  assert.match(voice, /if \(routines\.running\(\) === hit\.id\) return \{ say: `\$\{hit\.name\} is already running\.`, react: 'look' \};/);
  assert.ok(voice.indexOf('routines.running() === hit.id') < voice.indexOf('await routines.run(hit.id)'));
});

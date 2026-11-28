// A voice quick command gives up on a PC that does not answer, so the voice still gets a reply (src/core/web/voice-commands.ts).
// The module talks to the tablet at load, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/core/web/voice-commands.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the quick-command timeout is defined', () => {
  assert.match(src, /const READ_TIMEOUT_MS = 20e3;/);
});

test('every PC read and post in a quick command passes the timeout', () => {
  const calls = [
    /getJson<Wx>\('\/api\/weather\/forecast', READ_TIMEOUT_MS\)/,
    /getJson<HaScenes>\('\/api\/home-assistant\/scenes', READ_TIMEOUT_MS\)/,
    /postJson<HaResult>\('\/api\/home-assistant\/scene', \{ entity_id: m\.entity_id \}, READ_TIMEOUT_MS\)/,
    /getJson<CalEvents>\('\/api\/calendar\/events', READ_TIMEOUT_MS\)/,
    /getJson<HaDashboard>\('\/api\/home-assistant\/layout', READ_TIMEOUT_MS\)/,
    /postJson<HaResult>\('\/api\/home-assistant\/toggle', \{ entity_id: d\.entity_id, on: m\.on, voice: true \}, READ_TIMEOUT_MS\)/,
  ];
  for (const c of calls) assert.match(src, c, `has ${c.source}`);
});

test('every list read in a quick command passes the timeout', () => {
  assert.doesNotMatch(src, /readLists\(\)/, 'no bare readLists() call is left');
  assert.equal(src.match(/readLists\(READ_TIMEOUT_MS\)/g)?.length, 7, 'all seven list reads pass the timeout');
});

test('the connector read stays without a timeout, since it can run a slow Claude read on purpose', () => {
  assert.match(src, /getJson<\{ status\?: string; events\?: Ev\[\] \}>\(`\/api\/calendar\/connector\?day=\$\{day\}\$\{cachedOnly \? '&cached=1' : ''\}`\)/);
});

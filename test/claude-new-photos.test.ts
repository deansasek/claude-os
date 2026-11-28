// A tablet chat started with photos queued says the photos did not go (src/apps/claude/web/reply.ts newNativeChat). The app is
// DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('starting a tablet chat with photos queued says they were not sent', () => {
  const src = readFileSync(new URL('../src/apps/claude/web/reply.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('function newNativeChat(first: string): void {');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /if \(photos\.length\) \{ photos = \[\]; notify\(PHOTO_REFUSED, false\); \}/);
});

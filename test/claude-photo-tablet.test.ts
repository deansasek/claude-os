// Ask Claude about a photo is refused, with a notice, when the reply would go to a tablet chat (src/apps/claude/web/reply.ts
// askWithPhoto). The app is DOM code, so this reads its source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('a photo is refused when Claude is closed and tablet chats are on, not dropped silently', () => {
  const src = readFileSync(new URL('../src/apps/claude/web/reply.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('export function askWithPhoto(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /const onPcSession = mode === 'session' && !!openId && !!view\?\.canReply;/);
  assert.match(body, /if \(tabletTarget\(\) \|\| \(!onPcSession && nativeOn\(\)\)\) \{/);
  assert.match(body, /notify\(PHOTO_REFUSED, false\);/);
});

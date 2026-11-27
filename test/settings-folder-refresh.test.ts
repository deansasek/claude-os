// Settings reads the PC's folder list each time the sessions settings are painted, so a folder added or removed on the PC
// shows at once (src/apps/settings/web/index.ts paintSessions). The page is DOM code, so this reads its source. Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/settings/web/index.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('async function paintSessions(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('the folder list is read on every paint, not only once', () => {
  assert.ok(start > 0, 'paintSessions() exists');
  assert.doesNotMatch(body, /if \(!projects\) \{/);
  assert.match(body, /projects = await getJson<Project\[\]>\('\/api\/claude\/projects'\)/);
});

test('a failed read keeps the last good list', () => {
  assert.match(body, /catch \{ foldersFailed = true; \}/);
  assert.doesNotMatch(body, /projects = null/);
});

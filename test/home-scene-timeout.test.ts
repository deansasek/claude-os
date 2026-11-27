// A scene tap gives up on a scene post the PC never answers, so the button can be tapped again
// (src/core/web/dom.ts postJson; src/apps/home/web/index.ts setScene). The modules talk to the tablet at load, so this reads their source.
// Run with: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = readFileSync(path.join(root, 'src/core/web/dom.ts'), 'utf8').replace(/\r\n/g, '\n');
const home = readFileSync(path.join(root, 'src/apps/home/web/index.ts'), 'utf8').replace(/\r\n/g, '\n');

test('postJson takes an optional timeout, and applies it through AbortSignal.timeout', () => {
  assert.match(dom, /export async function postJson<T>\(url: string, body: unknown, timeoutMs\?: number\)/);
  const start = dom.indexOf('export async function postJson<T>');
  const body = dom.slice(start, dom.indexOf('\n}\n', start));
  assert.match(body, /AbortSignal\.timeout\(timeoutMs\)/);
});

test('the scene tap sends its post with a timeout', () => {
  assert.match(home, /const SCENE_TIMEOUT_MS = 20e3;/);
  assert.match(home, /postJson<HaResult>\('\/api\/home-assistant\/scene', \{ entity_id: id \}, SCENE_TIMEOUT_MS\)/);
});

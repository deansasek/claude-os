// A Browser reply that loses the PC says so while it waits (src/apps/browser/web/claude-panel.ts, watch).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/apps/browser/web/claude-panel.ts');
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('function watch(');
const body = src.slice(start, src.indexOf('\n}\n', start));

test('a reply that loses the PC says so while it waits', () => {
  assert.ok(start > 0, 'watch() exists');
  const offline = /catch \{ statusHtml = `[^`]*Can’t reach your PC[^`]*`; paint\(\); timer = window\.setTimeout\(tick, 2000\); return; \}/;
  assert.match(body, offline);
  assert.ok(body.search(offline) < body.indexOf('setTimeout(tick, 2000'), 'the offline status is set before the retry is scheduled');
});

/** The source of one top-level function in claude-panel.ts, from its signature to its closing brace. */
function fnBody(name: string): string {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name}() exists`);
  return src.slice(at, src.indexOf('\n}\n', at));
}

test('openSession says the PC is unreachable when the fetch fails and keeps its fallback', () => {
  const b = fnBody('openSession');
  const fetchAt = b.indexOf('await getJson<SessionView>');
  const offline = b.indexOf('Can’t reach your PC, so that session didn’t open.');
  assert.ok(fetchAt > 0, 'openSession fetches the session');
  assert.match(b, /catch \{\s*(?:if \(sessionId !== id\) return;[^\n]*\n\s*)?rows = \[\{ kind: 'note', html: 'Can’t reach your PC, so that session didn’t open\.' \}\];/);
  assert.ok(offline > fetchAt, 'the offline message follows the fetch');
  assert.match(b, /catch \{\s*(?:if \(sessionId !== id\) return;[^\n]*\n\s*)?rows = \[\{ kind: 'note', html: 'Couldn’t open that session\.' \}\];/, 'a bad answer keeps the old message');
});

test('openRecent says the PC is unreachable when the fetch fails and keeps its fallback', () => {
  const b = fnBody('openRecent');
  const fetchAt = b.indexOf('await getJson<History>');
  const offline = b.indexOf('Can’t reach your PC, so your sessions didn’t load.');
  assert.ok(fetchAt > 0, 'openRecent fetches the history');
  assert.match(b, /catch \{\s*el\.clList\.innerHTML = '<div class="cl-muted">Can’t reach your PC, so your sessions didn’t load\.<\/div>';\s*return;/);
  assert.ok(offline > fetchAt, 'the offline message follows the fetch');
  assert.match(b, /catch \{\s*el\.clList\.innerHTML = '<div class="cl-muted">Couldn’t load your sessions\.<\/div>';/, 'a bad answer keeps the old message');
});

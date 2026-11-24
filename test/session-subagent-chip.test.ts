// The session header's "N subagents working" chip (src/apps/claude/web/reply.ts, src/apps/claude/view.html).
// It uses the sidebar's wording and shows only when the count is above zero. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { LiveSession } from '../src/apps/claude/api.ts';

// The modules read the page's location when they load (via dom.ts); node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { subagentsWorking } = await import('../src/apps/claude/web/sessions/sidebar-groups.ts');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');
const session = (o: Partial<LiveSession>): LiveSession => ({
  id: 's', title: 'Title', folder: 'proj', branch: null, model: null, state: 'thinking', tool: null, age: 30, subagents: 0,
  working: 0, tokens: 0, surface: 'claude-desktop', open: false, hub: false, ...o,
});

test('the header chip uses the sidebar wording from subagentsWorking', () => {
  const reply = read('src/apps/claude/web/reply.ts');
  assert.match(reply, /import \{ subagentsWorking \} from '\.\/sessions\/sidebar-groups\.ts';/);
  assert.match(reply, /const subs = s \? subagentsWorking\(s\) : '';/);
  assert.equal(subagentsWorking(session({ working: 1 })), '1 subagent working');
  assert.equal(subagentsWorking(session({ working: 2 })), '2 subagents working');
});

test('the chip shows only when the count is above zero', () => {
  const reply = read('src/apps/claude/web/reply.ts');
  assert.match(reply, /\$\('svSubs'\)\.hidden = !subs;/);
  assert.equal(subagentsWorking(session({ working: 0 })), '');
});

test('the chip element is in the header and hidden by default', () => {
  assert.match(read('src/apps/claude/view.html'), /<span class="sv-subs" id="svSubs" hidden><\/span>/);
});

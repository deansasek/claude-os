// The Sessions sidebar shows "N subagents working" for a session running subagents, as the desktop app does
// (src/apps/claude/web/sessions/sidebar-groups.ts), and the server ends a subagent on its tool-use id too
// (src/apps/claude/server/subagents.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LiveSession } from '../src/apps/claude/api.ts';
import { runningSubagents } from '../src/apps/claude/server/subagents.ts';

// The modules read the page's location when they load (via dom.ts); node has none, so give it one first.
Object.assign(globalThis, { location: { search: '' } });
const { folderLive, groups, stateOf, subagentsWorking } = await import('../src/apps/claude/web/sessions/sidebar-groups.ts');

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const session = (o: Partial<LiveSession>): LiveSession => ({
  id: 's', title: 'Title', folder: 'proj', branch: null, model: null, state: 'thinking', tool: null, age: 30, subagents: 0,
  working: 0, tokens: 0, surface: 'claude-desktop', open: false, hub: false, ...o,
});

test('the subagent line counts running subagents', () => {
  assert.equal(subagentsWorking(session({})), '');
  assert.equal(subagentsWorking(session({ working: 1 })), '1 subagent working');
  assert.equal(subagentsWorking(session({ working: 3 })), '3 subagents working');
  assert.equal(subagentsWorking(session({ working: 1, age: 31 * 60 })), '');   // a long-quiet log: a lost end, not a live subagent
});

test('a session row shows its subagents instead of Thinking or Your turn', () => {
  assert.deepEqual(stateOf(session({ working: 1 }), NOW), { cls: 'busy', what: '1 subagent working' });
  assert.deepEqual(stateOf(session({ state: 'waiting', working: 2 }), NOW), { cls: 'busy', what: '2 subagents working' });
  assert.deepEqual(stateOf(session({ id: 'a', working: 1 }), NOW, new Set(['a'])), { cls: 'yours', what: 'Needs your OK' });
  assert.deepEqual(stateOf(session({}), NOW), { cls: 'busy', what: 'Thinking' });
});

test('a folder counts a session waiting on its subagents as working', () => {
  const g = groups([session({ id: 'a', state: 'waiting', working: 1 }), session({ id: 'b', state: 'waiting' })], NOW, null, '', false)[0]!;
  assert.equal(folderLive(g), '1 working · 1 waiting');
});

test('a task-notification ends a subagent by its tool-use id when the agentId is missing', () => {
  const launch = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: {} }] } };
  const launched = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'Async agent launched successfully.\nagentId: a1 (internal ID)' }] } };
  const done = { type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<tool-use-id>toolu_a</tool-use-id>\n<status>completed</status>\n</task-notification>' };
  assert.equal(runningSubagents([launch]), 1);
  assert.equal(runningSubagents([launch, launched]), 1);
  assert.equal(runningSubagents([launch, launched, done]), 0);
});

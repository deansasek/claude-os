// Unit tests for counting running subagents from session log events. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runningSubagents } from '../src/apps/claude/server/subagents.ts';

const launch = (id: string, toolUseId: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { run_in_background: true } }] } });
const launched = (toolUseId: string, agentId: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agentId} (internal ID)` }] }] } });
const finished = (agentId: string, toolUseId: string) => ({ type: 'queue-operation', operation: 'remove', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>` });

test('no subagents when the log has none', () => {
  assert.equal(runningSubagents([]), 0);
  assert.equal(runningSubagents([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } }]), 0);
});

test('a background agent counts from its launch until its task-notification', () => {
  const events: any[] = [launch('a', 'tu_a'), launched('tu_a', 'agent1')];
  assert.equal(runningSubagents(events), 1);
  events.push(finished('agent1', 'tu_a'));
  assert.equal(runningSubagents(events), 0);
});

test('two agents, one finished, counts the other', () => {
  const events = [launch('a', 'tu_a'), launched('tu_a', 'agent1'), launch('b', 'tu_b'), launched('tu_b', 'agent2'), finished('agent1', 'tu_a')];
  assert.equal(runningSubagents(events), 1);
});

test('a foreground agent counts until its tool_result arrives', () => {
  const running = [launch('a', 'tu_a')];
  assert.equal(runningSubagents(running), 1);
  const done = [...running, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_a', content: 'final answer' }] } }];
  assert.equal(runningSubagents(done), 0);
});

test('a finished notification for an unknown agent changes nothing', () => {
  assert.equal(runningSubagents([launch('a', 'tu_a'), launched('tu_a', 'agent1'), finished('other', 'tu_x')]), 1);
});

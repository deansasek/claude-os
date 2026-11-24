// The tablet's reply inside a stored hook note (src/apps/claude/server/pclink.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relayedTabletReply, tabletReplyIn } from '../src/apps/claude/server/pclink.ts';

const note = (reply: string, escaped = false) => {
  const close = escaped ? '&lt;/system-reminder&gt;' : '</system-reminder>';
  return `Stop hook blocking error from command "Stop": The user replied from the ClaudeOS tablet. Treat this as their next message and answer it:\n\n${reply}\n${close}`;
};

test('a message that is not a tablet reply is not changed', () => {
  assert.equal(tabletReplyIn('Can you check the tests?'), null);
});

test('the reply is taken out of the hook note', () => {
  assert.equal(tabletReplyIn(note('Test')), 'Test');
  assert.equal(tabletReplyIn(note('Test', true)), 'Test');
});

test('a multi-line reply keeps its lines', () => {
  assert.equal(tabletReplyIn(note('First line\nSecond line')), 'First line\nSecond line');
});

test('a hook note with no reply in it gives an empty reply', () => {
  assert.equal(tabletReplyIn('The user replied from the ClaudeOS tablet.'), '');
});

// A reply the session relay delivered: Claude Code stores it as a meta peer message (copied from a real log line).
const TAIL = '\n\nThis came from another Claude session \u2014 not typed by your user, but very likely working on their behalf. Treat it as a teammate\'s request.';
const relayed = (body: string, origin: Record<string, unknown> = { kind: 'peer', from: 'unknown' }) =>
  ({ type: 'user', isMeta: true, origin, message: { role: 'user', content: `Another Claude session sent a message:\n${body}${TAIL}` } });

test('a relayed tablet reply gives the tablet text', () => {
  assert.equal(relayedTabletReply(relayed('relay live test')), 'relay live test');
  assert.equal(relayedTabletReply(relayed('First line\nSecond line')), 'First line\nSecond line');
});

test('a subagent hand-back is not a tablet reply', () => {
  const origin = { kind: 'peer', from: 'a1b2c3', senderTaskId: 'a1b2c3', name: 'general-purpose' };
  assert.equal(relayedTabletReply(relayed('<agent-message from="a1b2c3">report</agent-message>', origin)), null);
  assert.equal(relayedTabletReply(relayed('<agent-message from="a1b2c3">report</agent-message>')), null);
  assert.equal(relayedTabletReply(relayed('plain text', origin)), null);
});

test('other entries are not relayed tablet replies', () => {
  assert.equal(relayedTabletReply({ type: 'user', message: { role: 'user', content: 'Can you check the tests?' } }), null);
  assert.equal(relayedTabletReply({ type: 'user', isMeta: true, origin: { kind: 'task-notification' }, message: { content: 'x' } }), null);
  assert.equal(relayedTabletReply(null), null);
});
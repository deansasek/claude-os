// The tablet's reply inside a stored hook note (src/apps/claude/server/pclink.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tabletReplyIn } from '../src/apps/claude/server/pclink.ts';

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

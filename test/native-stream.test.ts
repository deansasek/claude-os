// The native chat's stream-json parser and chat folding (src/apps/claude/web/native-stream.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvent, emptyChat, parseStreamLine, userSent, type NativeEvent } from '../src/apps/claude/web/native-stream.ts';

const AT = '2026-11-23T10:00:00.000Z';
const line = (o: unknown) => JSON.stringify(o);

test('system/init keeps the session id', () => {
  assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'init', session_id: 's1', model: 'haiku', tools: [] })), { type: 'init', sessionId: 's1' });
  assert.equal(parseStreamLine(line({ type: 'system', subtype: 'compact_boundary' })), null);
});

test('a text delta from a stream event', () => {
  const l = line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } });
  assert.deepEqual(parseStreamLine(l), { type: 'delta', text: 'Hel' });
  assert.equal(parseStreamLine(line({ type: 'stream_event', event: { type: 'message_start' } })), null);
});

test('an assistant message joins its text blocks', () => {
  const l = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: 'x' }, { type: 'text', text: ' there' }] } });
  assert.deepEqual(parseStreamLine(l), { type: 'text', text: 'Hello there' });
});

test('a result carries the text, cost and usage', () => {
  const l = line({ type: 'result', subtype: 'success', is_error: false, result: 'Hello', session_id: 's1', total_cost_usd: 0.0012, usage: { input_tokens: 9, output_tokens: 2 } });
  assert.deepEqual(parseStreamLine(l), { type: 'result', ok: true, text: 'Hello', sessionId: 's1', costUsd: 0.0012, inputTokens: 9, outputTokens: 2 });
  const bad = parseStreamLine(line({ type: 'result', subtype: 'error_during_execution', is_error: true }));
  assert.equal(bad?.type === 'result' && bad.ok, false);
});

test('lines that are not JSON or not used give null', () => {
  assert.equal(parseStreamLine('not json'), null);
  assert.equal(parseStreamLine('[1,2]'), null);
  assert.equal(parseStreamLine(line({ type: 'user', message: {} })), null);
});

test('a turn folds into the chat: deltas stream, the result ends it', () => {
  const events: NativeEvent[] = [
    { type: 'init', sessionId: 's1' }, { type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' },
  ];
  let c = userSent(emptyChat(), 'Say hello', AT);
  for (const e of events) c = applyEvent(c, e, AT);
  assert.equal(c.running, true);
  assert.equal(c.partial, 'Hello');
  assert.equal(c.sessionId, 's1');
  c = applyEvent(c, { type: 'result', ok: true, text: 'Hello', sessionId: 's1', costUsd: 0, inputTokens: 1, outputTokens: 1 }, AT);
  assert.equal(c.running, false);
  assert.deepEqual(c.entries, [{ kind: 'user', text: 'Say hello', at: AT }, { kind: 'assistant', text: 'Hello', at: AT }]);
});

test('an exit mid-reply keeps what streamed and says it stopped', () => {
  let c = applyEvent(userSent(emptyChat(), 'Hi', AT), { type: 'delta', text: 'Part' }, AT);
  c = applyEvent(c, { type: 'exit', code: 143 }, AT);
  assert.equal(c.running, false);
  assert.equal(c.entries[1].text, 'Part');
  assert.ok(c.error);
  // an exit while idle changes nothing
  assert.equal(applyEvent(c, { type: 'exit', code: 0 }, AT), c);
});

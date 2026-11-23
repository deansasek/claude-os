// The native chat's stream-json parser and chat folding (src/apps/claude/web/native-stream.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvent, chatAge, chatListed, contextOf, emptyChat, loadChat, parseStreamLine, saveChat, totalTokens, userSent, type NativeEvent } from '../src/apps/claude/web/native-stream.ts';

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

test('a result carries the text, cost, token counts and context window', () => {
  const l = line({ type: 'result', subtype: 'success', is_error: false, result: 'Hello', session_id: 's1', total_cost_usd: 0.0012,
    usage: { input_tokens: 9, output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 40 },
    modelUsage: { 'claude-haiku-5-5': { contextWindow: 200000 } } });
  assert.deepEqual(parseStreamLine(l), { type: 'result', ok: true, text: 'Hello', sessionId: 's1', costUsd: 0.0012,
    usage: { input: 9, output: 2, cacheRead: 100, cacheWrite: 40 }, window: 200000 });
  const noWindow = parseStreamLine(line({ type: 'result', subtype: 'success', is_error: false, result: 'x' }));
  assert.deepEqual(noWindow?.type === 'result' && noWindow.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(noWindow?.type === 'result' && noWindow.window, null);
  const bad = parseStreamLine(line({ type: 'result', subtype: 'error_during_execution', is_error: true }));
  assert.equal(bad?.type === 'result' && bad.ok, false);
});

test('tokens add up over turns; the last turn and the window give the context', () => {
  const turn = (usage: { input: number; output: number; cacheRead: number; cacheWrite: number }, window: number | null): NativeEvent =>
    ({ type: 'result', ok: true, text: 'ok', sessionId: 's1', costUsd: null, usage, window });
  let c = userSent(emptyChat(), 'one', AT);
  c = applyEvent(c, turn({ input: 5, output: 3, cacheRead: 0, cacheWrite: 20 }, 200000), AT);
  c = userSent(c, 'two', AT);
  c = applyEvent(c, turn({ input: 2, output: 4, cacheRead: 25, cacheWrite: 0 }, null), AT);
  assert.deepEqual(c.tokens, { input: 7, output: 7, cacheRead: 25, cacheWrite: 20 });
  assert.equal(totalTokens(c.tokens), 59);
  assert.deepEqual(c.last, { input: 2, output: 4, cacheRead: 25, cacheWrite: 0 });
  assert.deepEqual(contextOf(c), { used: 27, window: 200000 });
  assert.equal(contextOf(emptyChat()), null);
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
  c = applyEvent(c, { type: 'result', ok: true, text: 'Hello', sessionId: 's1', costUsd: 0, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, window: null }, AT);
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

test('a saved chat loads back with its session, entries and tokens; a reply that streamed is not kept', () => {
  let c = userSent(emptyChat(), 'Hi', AT);
  c = applyEvent(c, { type: 'init', sessionId: 's1' }, AT);
  c = applyEvent(c, { type: 'result', ok: true, text: 'Hello', sessionId: 's1', costUsd: null, usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 }, window: 1000 }, AT);
  c = userSent(c, 'Again', AT);
  c = applyEvent(c, { type: 'delta', text: 'Partly' }, AT);
  const back = loadChat(saveChat(c));
  assert.equal(back.sessionId, 's1');
  assert.deepEqual(back.entries, c.entries);
  assert.deepEqual(back.tokens, c.tokens);
  assert.deepEqual(back.last, c.last);
  assert.equal(back.window, 1000);
  assert.equal(back.running, false);
  assert.equal(back.partial, '');
});

test('an unreadable or foreign saved chat gives an empty chat', () => {
  assert.deepEqual(loadChat(null), emptyChat());
  assert.deepEqual(loadChat('not json'), emptyChat());
  assert.deepEqual(loadChat('{"v":2,"sessionId":"x"}'), emptyChat());
  const odd = loadChat(JSON.stringify({ v: 1, sessionId: 's2', entries: [{ kind: 'bogus', text: 'x' }, 'no', { kind: 'user', text: 'Kept', at: null }] }));
  assert.equal(odd.sessionId, 's2');
  assert.deepEqual(odd.entries, [{ kind: 'user', text: 'Kept', at: null }]);
});

test('a loaded chat with messages stays listed after it is closed, aged from its last message', () => {
  assert.equal(chatListed(emptyChat()), false);
  let c = userSent(emptyChat(), 'Hi', AT);
  assert.equal(chatListed(c), true);
  assert.equal(chatAge(c), 0);   // a reply is running
  c = applyEvent(c, { type: 'result', ok: true, text: 'Hello', sessionId: 's1', costUsd: null, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, window: null }, AT);
  const back = loadChat(saveChat(c));
  assert.equal(chatListed(back), true);
  assert.equal(chatAge(back, Date.parse(AT) + 90_000), 90);
  assert.equal(chatAge(loadChat(JSON.stringify({ v: 1, entries: [{ kind: 'user', text: 'x', at: null }] }))), 0);
});

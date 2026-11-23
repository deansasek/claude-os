// The native chat's stream-json parser and chat folding (src/apps/claude/web/native-stream.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEvent, chatAge, chatListed, clearedChat, contextOf, emptyChat, limitList, limitName, limitState, limitsUpdated, loadChat, newerSaved, parseStreamLine, saveChat,
  totalTokens, USAGE_REQUEST, usageRows, usageStale, userSent, type NativeEvent, type SeenLimit,
} from '../src/apps/claude/web/native-stream.ts';

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
    usage: { input: 9, output: 2, cacheRead: 100, cacheWrite: 40 }, window: 200000, reason: null });
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

test('a failed result names its reason: an expired login, a busy API, a turn out of steps', () => {
  const failed = (o: Record<string, unknown>) => parseStreamLine(line({ type: 'result', subtype: 'success', is_error: true, result: 'API Error', ...o }));
  const expired = failed({ api_error_status: 401 });
  assert.equal(expired?.type === 'result' && expired.reason, 'authentication_failed');
  assert.equal(applyEvent(userSent(emptyChat(), 'Hi', AT), expired!, AT).error, 'Sign in again under Settings → Apps → Claude.');
  assert.equal(applyEvent(userSent(emptyChat(), 'Hi', AT), failed({ api_error_status: 529 })!, AT).error, 'Claude is busy right now. Try again in a minute.');
  const steps = parseStreamLine(line({ type: 'result', subtype: 'error_max_turns', is_error: true }));
  assert.equal(applyEvent(userSent(emptyChat(), 'Hi', AT), steps!, AT).error, 'Claude ran out of steps before it finished. Ask it to carry on.');
  // an unknown status or subtype keeps the general line
  assert.equal(applyEvent(userSent(emptyChat(), 'Hi', AT), failed({ api_error_status: 500 })!, AT).error, 'That reply didn’t finish. Try again.');
});

test('a retry or compacting line shows while the reply runs; the next reply piece clears it', () => {
  const retry = parseStreamLine(line({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 1000, error_status: 529, error: 'overloaded' }));
  assert.deepEqual(retry, { type: 'status', text: 'Retrying (2 of 10)' });
  assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'status', status: 'compacting' })), { type: 'status', text: 'Compacting' });
  assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'status', status: null })), { type: 'status', text: null });
  assert.equal(parseStreamLine(line({ type: 'system', subtype: 'status', status: 'requesting' })), null);
  let c = applyEvent(userSent(emptyChat(), 'Hi', AT), retry!, AT);
  assert.equal(c.status, 'Retrying (2 of 10)');
  assert.equal(applyEvent(c, { type: 'status', text: null }, AT).status, null);
  c = applyEvent(applyEvent(c, { type: 'status', text: 'Compacting' }, AT), { type: 'delta', text: 'Hel' }, AT);
  assert.equal(c.status, null);
  // outside a reply a status changes nothing
  assert.equal(applyEvent(emptyChat(), { type: 'status', text: 'Compacting' }, AT).status, null);
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

test('a failed reply is a note, not Claude’s reply; a rejected plan limit says when it resets', () => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const failed = (text: string): NativeEvent => ({ type: 'result', ok: false, text, sessionId: 's1', costUsd: null, usage, window: null });
  // no limit known: the general line, and the CLI's error text is not kept as a reply
  let c = applyEvent(userSent(emptyChat(), 'Hi', AT), failed('API Error: 500 internal'), AT);
  assert.deepEqual(c.entries, [{ kind: 'user', text: 'Hi', at: AT }]);
  assert.equal(c.error, 'That reply didn’t finish. Try again.');
  // a limit the CLI rejected, still in force: the note names the reset time
  const resetAt = '2026-11-23T15:00:00.000Z';
  c = applyEvent(userSent(emptyChat(), 'Hi', AT), { type: 'limits', limits: [{ type: 'five_hour', status: 'rejected', used: 100, resetsAt: resetAt }] }, AT);
  c = applyEvent(userSent(c, 'Again', AT), failed('Claude AI usage limit reached'), AT);
  assert.deepEqual(c.entries.map(e => e.kind), ['user', 'user']);
  assert.match(c.error ?? '', /^Limit reached, resets \S/);
  // a rejected limit whose reset time has passed no longer counts
  const past = applyEvent(userSent(applyEvent(emptyChat(), { type: 'limits', limits: [{ type: 'five_hour', status: 'rejected', used: 100, resetsAt: '2026-11-23T09:00:00.000Z' }] }, AT), 'Hi', AT), failed('boom'), AT);
  assert.equal(past.error, 'That reply didn’t finish. Try again.');
});

test('a stop the user asked for reads as stopped: the kept part is marked, and the exit is not an error', () => {
  let c = applyEvent(userSent(emptyChat(), 'Hi', AT), { type: 'delta', text: 'Part' }, AT);
  c = applyEvent(c, { type: 'stop' }, AT);
  c = applyEvent(c, { type: 'exit', code: 143 }, AT);
  assert.equal(c.running, false);
  assert.equal(c.stopped, false);
  assert.deepEqual(c.entries[1], { kind: 'assistant', text: 'Part (stopped)', at: AT });
  assert.equal(c.error, 'Stopped');
});

test('a stopped reply whose result comes back as a failure keeps the streamed text, marked, with no limit note', () => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let c = applyEvent(userSent(emptyChat(), 'Hi', AT), { type: 'delta', text: 'Part' }, AT);
  c = applyEvent(c, { type: 'stop' }, AT);
  c = applyEvent(c, { type: 'result', ok: false, text: 'Error: interrupted', sessionId: 's1', costUsd: null, usage, window: null }, AT);
  assert.equal(c.entries[1]?.text, 'Part (stopped)');
  assert.equal(c.error, 'Stopped');
  // a stop before anything streamed adds no reply, only the note
  let d = applyEvent(userSent(emptyChat(), 'Hi', AT), { type: 'stop' }, AT);
  d = applyEvent(d, { type: 'exit', code: 143 }, AT);
  assert.deepEqual(d.entries.map(e => e.kind), ['user']);
  assert.equal(d.error, 'Stopped');
  // a new message clears the stop
  assert.equal(userSent(c, 'Again', AT).stopped, false);
  // a stop while idle changes nothing
  assert.equal(applyEvent(emptyChat(), { type: 'stop' }, AT).stopped, false);
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

test('of the file copy and the localStorage copy, the one saved last wins', () => {
  const chat = userSent(emptyChat(), 'Hi', AT);
  const older = saveChat(chat, 1000), newer = saveChat(userSent(chat, 'Again', AT), 2000);
  assert.equal(newerSaved(newer, older), newer);
  assert.equal(newerSaved(older, newer), newer);   // the file write failed: localStorage is newer
  assert.equal(newerSaved(newer, newer), newer);
  assert.equal(newerSaved(older, null), older);    // a page that never saved to localStorage
  assert.equal(newerSaved(null, older), older);    // an older app build: no file
  assert.equal(newerSaved('not json', older), older);
  assert.equal(newerSaved(null, null), null);
  const noTime = JSON.stringify({ v: 1, entries: [] });   // saved before savedAt existed
  assert.equal(newerSaved(older, noTime), older);
  assert.equal(newerSaved(noTime, older), older);
  assert.deepEqual(loadChat(newerSaved(newer, older)).entries.map(e => e.text), ['Hi', 'Again']);
});
// rate_limit_event, as the CLI sends it: utilization is a fraction, resetsAt is Unix seconds
const RESET = 1795000000, RESET_ISO = new Date(RESET * 1000).toISOString();
const rateLine = (info: unknown) => line({ type: 'rate_limit_event', rate_limit_info: info, uuid: 'u1', session_id: 's1' });

test('a rate_limit_event keeps the status, window type, utilization and reset time', () => {
  assert.deepEqual(parseStreamLine(rateLine({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.81, resetsAt: RESET, surpassedThreshold: 0.75 })),
    { type: 'limits', limits: [{ type: 'seven_day', status: 'allowed_warning', used: 81, resetsAt: RESET_ISO }] });
});

test('a rate_limit_event without utilization keeps the status and reset time only', () => {
  assert.deepEqual(parseStreamLine(rateLine({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: RESET, isUsingOverage: false })),
    { type: 'limits', limits: [{ type: 'five_hour', status: 'allowed', used: null, resetsAt: RESET_ISO }] });
  assert.deepEqual(parseStreamLine(rateLine({ status: 'rejected', rateLimitType: 'seven_day_opus' })),
    { type: 'limits', limits: [{ type: 'seven_day_opus', status: 'rejected', used: null, resetsAt: null }] });
});

test('a rate_limit_event reads unifiedWindows; the named window wins over its own entry', () => {
  const e = parseStreamLine(rateLine({
    status: 'allowed', rateLimitType: 'five_hour', resetsAt: RESET,
    unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1, status: 'allowed_warning' }, seven_day: { utilization: 0.12, resetsAt: RESET } },
  }));
  assert.deepEqual(e, { type: 'limits', limits: [
    { type: 'five_hour', status: 'allowed', used: 40, resetsAt: RESET_ISO },
    { type: 'seven_day', status: '', used: 12, resetsAt: RESET_ISO },
  ] });
});

test('a rate_limit_event with no window type, or no info, is dropped', () => {
  assert.equal(parseStreamLine(rateLine({ status: 'allowed' })), null);
  assert.equal(parseStreamLine(line({ type: 'rate_limit_event' })), null);
});

test('the chat keeps the latest limit per window, across saves and a fresh chat', () => {
  const later = '2026-11-23T11:00:00.000Z';
  let c = applyEvent(emptyChat(), { type: 'limits', limits: [{ type: 'seven_day', status: 'allowed', used: null, resetsAt: RESET_ISO }] }, AT);
  c = applyEvent(c, { type: 'limits', limits: [{ type: 'five_hour', status: 'allowed', used: null, resetsAt: null }] }, AT);
  c = applyEvent(c, { type: 'limits', limits: [{ type: 'seven_day', status: 'allowed_warning', used: 76, resetsAt: RESET_ISO }] }, later);
  assert.deepEqual(limitList(c).map(l => [l.type, l.status, l.used, l.at]),
    [['five_hour', 'allowed', null, AT], ['seven_day', 'allowed_warning', 76, later]]);
  assert.deepEqual(loadChat(saveChat(c)).limits, c.limits);
  assert.deepEqual(loadChat(JSON.stringify({ v: 1, entries: [] })).limits, {});   // saved before limits existed
});

test('a limit reads as the percent used, or its status when there is no utilization', () => {
  assert.equal(limitState({ type: 'five_hour', status: 'allowed', used: 38.4, resetsAt: null }), '38% used');
  assert.equal(limitState({ type: 'five_hour', status: 'allowed', used: null, resetsAt: null }), 'Within limit');
  assert.equal(limitState({ type: 'five_hour', status: 'rejected', used: null, resetsAt: null }), 'Limit reached');
  assert.equal(limitName('five_hour'), 'Session limit');
  assert.equal(limitName('something_new'), 'something_new');
});

// the get_usage control reply, as the CLI sends it: utilization is a percent, resets_at an ISO time (CLI 2.1.318)
const usageLine = (rate_limits: unknown, request_id = USAGE_REQUEST, subtype = 'success') =>
  line({ type: 'control_response', response: { subtype, request_id, response: { subscription_type: 'max', rate_limits_available: true, rate_limits, behaviors: null } } });

test('a get_usage reply gives the session, weekly and per-model windows', () => {
  const e = parseStreamLine(usageLine({
    five_hour: { utilization: 15, resets_at: '2026-11-24T00:00:00.000Z' }, seven_day: { utilization: 21, resets_at: '2026-11-28T20:00:00.000Z' },
    seven_day_opus: null, seven_day_oauth_apps: { utilization: 3, resets_at: null },
    model_scoped: [{ display_name: 'Fable', utilization: 140, resets_at: null }, { utilization: 1 }],
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
  }));
  assert.deepEqual(e, { type: 'limits', limits: [
    { type: 'five_hour', status: '', used: 15, resetsAt: '2026-11-24T00:00:00.000Z' },
    { type: 'seven_day', status: '', used: 21, resetsAt: '2026-11-28T20:00:00.000Z' },
    { type: 'model:Fable', status: '', used: 100, resetsAt: null },
  ] });
});

test('a get_usage reply with no limits, an error, or another request id is dropped', () => {
  assert.equal(parseStreamLine(usageLine(null)), null);
  assert.equal(parseStreamLine(usageLine({ five_hour: { utilization: 1, resets_at: null } }, 'other')), null);
  assert.equal(parseStreamLine(usageLine({ five_hour: { utilization: 1, resets_at: null } }, USAGE_REQUEST, 'error')), null);
});

test('the runner end-of-check line', () => {
  assert.deepEqual(parseStreamLine(line({ type: 'usage_check', ok: true })), { type: 'usageChecked', ok: true });
  assert.deepEqual(parseStreamLine(line({ type: 'usage_check' })), { type: 'usageChecked', ok: false });
  const c = emptyChat();
  assert.equal(applyEvent(c, { type: 'usageChecked', ok: true }), c);
});

test('clearing the chat empties the list and the session, and keeps the plan limits', () => {
  let c = applyEvent(userSent(emptyChat(), 'Hi', AT), { type: 'init', sessionId: 's1' }, AT);
  c = applyEvent(c, { type: 'limits', limits: [{ type: 'five_hour', status: 'allowed', used: 10, resetsAt: null }] }, AT);
  c = applyEvent(c, { type: 'result', ok: true, text: 'Hello', sessionId: 's1', costUsd: null, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, window: null }, AT);
  const cleared = clearedChat(c);
  assert.deepEqual(cleared.entries, []);
  assert.equal(cleared.sessionId, null);
  assert.equal(chatListed(cleared), false);
  assert.deepEqual(cleared.limits, c.limits);
});

test('a get_usage window keeps the status the last rate_limit_event gave', () => {
  let c = applyEvent(emptyChat(), { type: 'limits', limits: [{ type: 'five_hour', status: 'allowed_warning', used: null, resetsAt: null }] }, AT);
  c = applyEvent(c, { type: 'limits', limits: [{ type: 'five_hour', status: '', used: 82, resetsAt: RESET_ISO }] }, AT);
  assert.deepEqual(c.limits.five_hour, { type: 'five_hour', status: 'allowed_warning', used: 82, resetsAt: RESET_ISO, at: AT });
});

const seen = (type: string, used: number | null, at: string | null, status = 'allowed'): SeenLimit => ({ type, status, used, resetsAt: RESET_ISO, at });

test('the Usage page rows: session, weekly, then per model; extra usage left out', () => {
  const rows = usageRows([seen('overage', 5, AT), seen('model:Fable', 8.6, AT), seen('seven_day', null, AT, 'allowed_warning'), seen('five_hour', 15, AT), seen('seven_day_opus', 2, AT)]);
  assert.deepEqual(rows.map(r => [r.name, r.used, r.state]), [
    ['Current session', 15, '15% used'], ['Weekly, all models', null, 'Close to the limit'], ['Weekly · Opus', 2, '2% used'], ['Weekly · Fable', 9, '9% used'],
  ]);
  assert.equal(rows[0]!.resetsAt, RESET_ISO);
  assert.equal(limitName('model:Fable'), 'Weekly limit · Fable');
});

test('the Usage page asks the CLI again only when the newest limit is old or missing', () => {
  const now = Date.parse(AT), later = '2026-11-23T10:08:00.000Z';
  assert.equal(limitsUpdated([seen('five_hour', 1, AT), seen('seven_day', 1, later), seen('seven_day_opus', 1, null)]), later);
  assert.equal(limitsUpdated([seen('five_hour', 1, null)]), null);
  assert.equal(usageStale([], 600e3, now), true);
  assert.equal(usageStale([seen('five_hour', 1, null)], 600e3, now), true);
  assert.equal(usageStale([seen('five_hour', 1, AT)], 600e3, now + 599e3), false);
  assert.equal(usageStale([seen('five_hour', 1, AT)], 600e3, now + 601e3), true);
});

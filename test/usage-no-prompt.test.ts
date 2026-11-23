// The usage check's get_usage reply with no model turn before it (ClaudeCli.usageCheck; parser in
// src/apps/claude/web/native-stream.ts). Shapes from CLI 2.1.330: with no turn, rate_limits is the plan-usage endpoint's
// body (or the CLI's saved copy of it), so it carries fields the page does not use. Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvent, emptyChat, parseStreamLine, USAGE_REQUEST, usageRows } from '../src/apps/claude/web/native-stream.ts';

const AT = '2026-11-23T10:00:00.000Z';
const reply = (response: unknown, subtype = 'success') =>
  JSON.stringify({ type: 'control_response', response: { subtype, request_id: USAGE_REQUEST, response } });

// the endpoint's answer, as get_usage passes it on before any turn
const ENDPOINT = {
  five_hour: { utilization: 42.0, resets_at: '2026-11-23T14:59:59.912345+00:00' },
  seven_day: { utilization: 18.0, resets_at: '2026-11-28T09:00:00.000000+00:00' },
  seven_day_opus: null, seven_day_sonnet: null, seven_day_oauth_apps: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
  limits: [{ kind: 'five_hour', utilization: 42 }], model_scoped: [],
};

test('a get_usage reply with no turn before it gives the session and weekly windows', () => {
  const e = parseStreamLine(reply({ session: { total_cost_usd: 0, model_usage: {} }, subscription_type: 'max',
    rate_limits_available: true, rate_limits: ENDPOINT, behaviors: null }));
  assert.deepEqual(e, { type: 'limits', limits: [
    { type: 'five_hour', status: '', used: 42, resetsAt: '2026-11-23T14:59:59.912Z' },
    { type: 'seven_day', status: '', used: 18, resetsAt: '2026-11-28T09:00:00.000Z' },
  ] });
});

test('the no-turn windows fill the Usage rows on a fresh chat', () => {
  const e = parseStreamLine(reply({ rate_limits_available: true, rate_limits: ENDPOINT, behaviors: null }));
  assert.ok(e && e.type === 'limits');
  const c = applyEvent(emptyChat(), e, AT);
  assert.equal(c.limits.five_hour.used, 42);
  assert.equal(c.limits.seven_day.resetsAt, '2026-11-28T09:00:00.000Z');
  assert.equal(usageRows(Object.values(c.limits)).length, 2);
});

test('a get_usage reply when the CLI has no windows, or no plan limits, is dropped', () => {
  assert.equal(parseStreamLine(reply({ rate_limits_available: true, rate_limits: null, behaviors: null })), null);
  assert.equal(parseStreamLine(reply({ rate_limits_available: false, rate_limits: null, behaviors: null })), null);
  assert.equal(parseStreamLine(reply({ rate_limits_available: true, rate_limits: { five_hour: null, seven_day: null } })), null);
  assert.equal(parseStreamLine(reply({ error: 'get_usage is not supported in this context' }, 'error')), null);
});

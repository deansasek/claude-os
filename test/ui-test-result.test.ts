// The ui_test check's result (src/apps/claude/web/ui-test-result.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResult, logText, probeResult, type UiProbe } from '../src/apps/claude/web/ui-test-result.ts';

const SIDEBAR = '<button class="sb-folder" data-folder="On this tablet"><span class="label">On this tablet</span></button>'
  + '<div class="sb-row yours" data-id="native" role="button"><span class="sb-name">Hello test</span></div>';
const REPLY = 'Hello! The test message came through. How can I help you today?';
const good = (o: Partial<UiProbe> = {}): UiProbe => ({
  replyText: REPLY, sidebarHtml: SIDEBAR, ringLabel: '3% of context used · 6k / 200k', tokens: 6123, model: 'Haiku', messagesShown: 2, error: null, ...o,
});

test('a probe keeps only the reply length and its first 20 characters', () => {
  const p = probeResult(good());
  assert.equal(p.replyLength, REPLY.length);
  assert.equal(p.replyStart, REPLY.slice(0, 20));
  assert.equal(p.listed, true);
  assert.equal(p.tokenLine, true);
  assert.ok(!JSON.stringify(p).includes('How can I help'));
});

test('the chat counts as listed only under "On this tablet"', () => {
  assert.equal(probeResult(good({ sidebarHtml: '<div data-id="native"></div>' })).listed, false);
  const shut = probeResult(good({ sidebarHtml: '<button class="sb-folder shut" data-folder="On this tablet"></button>' }));
  assert.equal(shut.tabletFolder, true);
  assert.equal(shut.listed, false);
  assert.equal(probeResult(good({ sidebarHtml: '' })).listed, false);
});

test('no ring means no token line', () => {
  assert.equal(probeResult(good({ ringLabel: null })).tokenLine, false);
  assert.equal(probeResult(good({ ringLabel: '' })).tokenLine, false);
});

test('a full run passes, and the message text never goes into the result', () => {
  const r = buildResult({ run: '1', nativeOn: true, waitedMs: 4200, afterReply: good(), afterReload: good() });
  assert.equal(r.ok, true);
  assert.deepEqual(r.failed, []);
  assert.equal(r.replied, true);
  const text = logText(r);
  assert.ok(text.split('\n').every(l => l.startsWith('uitest:')));
  assert.match(text, /PASS/);
  assert.ok(!text.includes('Hello test'));
  assert.ok(!text.includes('How can I help'));
});

test('each missing piece is named', () => {
  const r = buildResult({ run: '2', nativeOn: true, waitedMs: 90000,
    afterReply: good({ replyText: null, ringLabel: null, model: null }), afterReload: good({ sidebarHtml: '', messagesShown: 1 }) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, ['no reply', 'no token line', 'no model', 'not listed after reload', 'messages missing after reload']);
  assert.match(logText(r), /^uitest: native-chat run=2 FAIL \(no reply/);
  const none = buildResult({ run: '3', nativeOn: false, waitedMs: 0, afterReply: good(), afterReload: null });
  assert.deepEqual(none.failed, ['no reload result']);
  assert.equal(none.afterReload, null);
});

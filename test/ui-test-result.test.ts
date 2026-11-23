// The ui_test check's result (src/apps/claude/web/ui-test-result.ts). Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPhase2, buildResult, logText, markerText, phase2Text, probeResult, readMarker, restartOf, type UiProbe } from '../src/apps/claude/web/ui-test-result.ts';

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

// ---------- phase 2: after the app was closed and opened again ----------
const MARK = { run: '10', at: 5000, process: '123-900', sessionId: 's1' };
const phase2 = (o: Partial<Parameters<typeof buildPhase2>[0]> = {}) => buildPhase2({
  run: '20', marker: readMarker(markerText(MARK)), sessionId: 's1', process: '456-7000', pageStartedAt: 9000, phase1StateLeft: false,
  loadedFrom: 'file', probe: good({ replyText: REPLY, ringLabel: null }), ...o,
});

test('the phase 1 marker reads back; anything else is no marker', () => {
  assert.deepEqual(readMarker(markerText(MARK)), { v: 1, ok: true, ...MARK });
  assert.equal(readMarker(null), null);
  assert.equal(readMarker(''), null);   // phase 1 clears it when it starts
  assert.equal(readMarker('not json'), null);
  assert.equal(readMarker(JSON.stringify({ v: 1, ok: false, run: '10', at: 5000 })), null);
  assert.deepEqual(readMarker(JSON.stringify({ v: 1, ok: true, run: '10', at: 5000 })), { v: 1, ok: true, run: '10', at: 5000, process: null, sessionId: null });
});

test('a restart is told by the process id, and a fresh page by its start time and lost sessionStorage', () => {
  const m = readMarker(markerText(MARK))!;
  assert.deepEqual(restartOf({ marker: m, process: '456-7000', pageStartedAt: 9000, phase1StateLeft: false }), { process: 'yes', freshPage: true });
  assert.deepEqual(restartOf({ marker: m, process: '123-900', pageStartedAt: 4000, phase1StateLeft: true }), { process: 'no', freshPage: false });
  assert.deepEqual(restartOf({ marker: m, process: null, pageStartedAt: 9000, phase1StateLeft: true }), { process: 'unknown', freshPage: false });
  assert.equal(restartOf({ marker: { ...m, process: null }, process: '1-1', pageStartedAt: 9000, phase1StateLeft: false }).process, 'unknown');
});

test('phase 2 passes when the phase 1 chat is listed with its messages, and says if the app restarted', () => {
  const r = phase2();
  assert.equal(r.ok, true);
  assert.deepEqual(r.failed, []);
  assert.equal(r.sameChat, true);
  const text = phase2Text(r);
  assert.ok(text.split('\n').every(l => l.startsWith('uitest2:')));
  assert.match(text, /^uitest2: native-chat-restart run=20 phase1=10 PASS restarted=yes freshPage=yes from=file\n/);
  assert.ok(!text.includes('Hello test'));
  assert.ok(!text.includes('How can I help'));
  assert.match(phase2Text(phase2({ process: '123-900', pageStartedAt: 100, phase1StateLeft: true })), /PASS restarted=no freshPage=no/);
});

test('phase 2 names what is missing', () => {
  assert.deepEqual(phase2({ marker: null }).failed, ['no phase 1 pass']);
  assert.equal(phase2({ marker: null }).restarted, null);
  assert.match(phase2Text(phase2({ marker: null })), /^uitest2: native-chat-restart run=20 phase1=none FAIL \(no phase 1 pass\) from=file/);
  assert.deepEqual(phase2({ sessionId: 'other' }).failed, ['not the phase 1 chat']);
  assert.deepEqual(phase2({ sessionId: null, probe: good({ sidebarHtml: '', messagesShown: 0 }) }).failed,
    ['not the phase 1 chat', 'not listed', 'messages missing']);
});

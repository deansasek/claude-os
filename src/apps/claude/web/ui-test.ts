// TEST ONLY: the tablet app's ui_test launch (adb shell am start -n hub.kiosk/.MainActivity --ez ui_test true).
// MainActivity sets window.hubUiTest to a run id and calls window.hubTestRun (main.web.ts), which loads this module.
// Nothing loads it otherwise. The check: open Claude, start a native chat with "Hello test" through the composer's
// send path, wait for the reply, read the sidebar, token line and model, reload the page, and read them again.
// The phase is kept in sessionStorage across the reload; the result goes to the PC log (POST /api/spike/node).
// When those checks pass, a marker goes into the app's files folder (device.pageFileWrite 'uitest').
// Phase 2 (--ez ui_test_phase2 true, after am force-stop hub.kiosk): no message is sent; the check reads the marker and
// expects the same chat listed under "On this tablet" with its messages shown, and says whether the app process and
// the page really started fresh. Its result lines start with "uitest2:".
// Note: the test chat replaces the chat on this tablet (there is one native chat at a time).
import { device } from '../../../core/web/device.ts';
import { openApp } from '../../../core/web/system.ts';
import { NATIVE_ID, NATIVE_MODELS, nativeLoadedFrom, nativeOn, nativeSessionId, nativeView } from './native.ts';
import { openNewScreen, openSession, sidebarDrawn, startNativeChat } from './reply.ts';
import { buildPhase2, buildResult, logText, markerText, phase2Text, readMarker, type UiProbe } from './ui-test-result.ts';

const KEY = 'uitest.native';
const MARKER = 'uitest';
const MESSAGE = 'Hello test';
const REPLY_WAIT_MS = 90_000;

interface Saved { run: string; phase: 'reload' | 'done'; waitedMs: number; afterReply: UiProbe }

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const log = (line: string): void => console.log(`uitest: ${line}`);

function readSaved(): Saved | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') as Saved | null; } catch { return null; }
}
function writeSaved(s: Saved): void { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the reload step then fails */ } }

/** The phase-1 marker in the app's files folder ('' clears it). False when the app build cannot keep files. */
function writeMarker(text: string): boolean { try { device.pageFileWrite(MARKER, text); return true; } catch { return false; } }

/** Text to the PC log (host/logs/spike-node.log): the page's own hub, the spike route. */
async function post(text: string): Promise<void> {
  try {
    const r = await fetch('/api/spike/node', { method: 'POST', headers: { 'X-Spike': 'node', 'Content-Type': 'text/plain' }, body: text });
    log(`posted ${r.status}`);
  } catch (e) { log(`post failed ${String(e)}`); }
}

/** What the page shows now. */
function probe(): UiProbe {
  const v = nativeView();
  const reply = [...v.transcript].reverse().find(e => e.kind === 'assistant')?.text ?? null;
  const ring = document.getElementById('svCtx');
  const shown = !!ring && !ring.hidden;
  const label = NATIVE_MODELS.find(m => m.value === v.session?.model)?.label ?? v.session?.model ?? null;
  return {
    replyText: reply, sidebarHtml: sidebarDrawn(), ringLabel: shown ? ring!.getAttribute('aria-label') : null,
    tokens: v.session?.tokens ?? 0, model: label,
    messagesShown: document.getElementById('svLog')?.querySelectorAll('.m-msg').length ?? 0,
    error: v.turn ? null : [...v.transcript].reverse().find(e => e.kind === 'note')?.text ?? null,
  };
}

/** The sidebar from the new-session screen (so the chat is not open), then the chat itself. */
async function sidebarThenChat(): Promise<UiProbe> {
  openApp('claude');
  void openNewScreen();
  await wait(1500);
  const side = sidebarDrawn();
  openSession(NATIVE_ID);
  await wait(1500);
  return { ...probe(), sidebarHtml: side };
}

/** Phase 1: a new native chat, its reply, the first look, then a reload. */
async function beforeReload(run: string): Promise<void> {
  log(`start run=${run} nativeOn=${nativeOn()}`);
  writeMarker('');   // an older run's pass must not count for this one
  openApp('claude');
  await wait(500);
  startNativeChat(MESSAGE);
  const t0 = Date.now();
  while (Date.now() - t0 < REPLY_WAIT_MS) {
    await wait(1000);
    if (!nativeView().turn) break;   // the reply finished (or failed)
  }
  const waitedMs = Date.now() - t0;
  await wait(1000);   // the screen repaints after the last event
  const afterReply = probe();
  writeSaved({ run, phase: 'reload', waitedMs, afterReply });
  log(`reply after ${waitedMs} ms, reloading`);
  await post(`uitest: native-chat run=${run} phase 1 done after ${waitedMs} ms; reloading`);
  location.reload();
}

/** Phase 1 after the reload: the sidebar, then the chat; the marker for phase 2 only when everything passed. */
async function afterReload(s: Saved): Promise<void> {
  writeSaved({ ...s, phase: 'done' });
  const afterReloadProbe = await sidebarThenChat();
  const r = buildResult({ run: s.run, nativeOn: nativeOn(), waitedMs: s.waitedMs, afterReply: s.afterReply, afterReload: afterReloadProbe });
  let marked = false;
  if (r.ok) marked = writeMarker(markerText({ run: s.run, at: Date.now(), process: device.processId(), sessionId: nativeSessionId() }));
  log(r.ok ? `PASS (marker ${marked ? 'kept' : 'not kept: older app build'})` : `FAIL ${r.failed.join(', ')}`);
  await post(logText(r) + (r.ok ? `\nuitest: phase 2 marker ${marked ? 'kept' : 'not kept (older app build)'}` : ''));
}

/** Phase 2: after the app was closed and opened again. No message is sent. */
async function phase2(run: string): Promise<void> {
  let markerFile: string | null = null;
  try { markerFile = device.pageFileRead(MARKER); } catch { /* older app build: the check fails with no phase 1 pass */ }
  const marker = readMarker(markerFile);
  log(`phase 2 run=${run} phase1=${marker?.run ?? 'none'}`);
  const p = await sidebarThenChat();
  const r = buildPhase2({ run, marker, sessionId: nativeSessionId(), process: device.processId(), pageStartedAt: performance.timeOrigin,
    phase1StateLeft: readSaved() != null, loadedFrom: nativeLoadedFrom, probe: p });
  log(r.ok ? 'phase 2 PASS' : `phase 2 FAIL ${r.failed.join(', ')}`);
  await post(phase2Text(r));
}

/** Run (or resume after the reload) the check for this run id. A finished run does nothing. phase: 2 after a restart. */
export async function runUiTest(run: string, phase = 1): Promise<void> {
  if (phase === 2) {
    try { await phase2(run); } catch (e) {
      log(`error ${String(e)}`);
      await post(`uitest2: native-chat-restart run=${run} FAIL (error: ${String(e).slice(0, 200)})`);
    }
    return;
  }
  const s = readSaved();
  try {
    if (s?.run === run) { if (s.phase === 'reload') await afterReload(s); return; }
    await beforeReload(run);
  } catch (e) {
    log(`error ${String(e)}`);
    await post(`uitest: native-chat run=${run} FAIL (error: ${String(e).slice(0, 200)})`);
  }
}

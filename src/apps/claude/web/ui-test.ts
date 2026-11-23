// TEST ONLY: the tablet app's ui_test launch (adb shell am start -n hub.kiosk/.MainActivity --ez ui_test true).
// MainActivity sets window.hubUiTest to a run id and calls window.hubTestRun (main.web.ts), which loads this module.
// Nothing loads it otherwise. The check: open Claude, start a native chat with "Hello test" through the composer's
// send path, wait for the reply, read the sidebar, token line and model, reload the page, and read them again.
// The phase is kept in sessionStorage across the reload; the result goes to the PC log (POST /api/spike/node).
// Note: the test chat replaces the chat on this tablet (there is one native chat at a time).
import { openApp } from '../../../core/web/system.ts';
import { NATIVE_ID, NATIVE_MODELS, nativeOn, nativeView } from './native.ts';
import { openNewScreen, openSession, sidebarDrawn, startNativeChat } from './reply.ts';
import { buildResult, logText, type UiProbe } from './ui-test-result.ts';

const KEY = 'uitest.native';
const MESSAGE = 'Hello test';
const REPLY_WAIT_MS = 90_000;

interface Saved { run: string; phase: 'reload' | 'done'; waitedMs: number; afterReply: UiProbe }

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const log = (line: string): void => console.log(`uitest: ${line}`);

function readSaved(): Saved | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') as Saved | null; } catch { return null; }
}
function writeSaved(s: Saved): void { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the reload step then fails */ } }

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

/** Phase 1: a new native chat, its reply, the first look, then a reload. */
async function beforeReload(run: string): Promise<void> {
  log(`start run=${run} nativeOn=${nativeOn()}`);
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

/** Phase 2: after the reload, the sidebar (from the new-session screen, so the chat is not open), then the chat itself. */
async function afterReload(s: Saved): Promise<void> {
  writeSaved({ ...s, phase: 'done' });
  openApp('claude');
  void openNewScreen();
  await wait(1500);
  const side = sidebarDrawn();
  openSession(NATIVE_ID);
  await wait(1500);
  const afterReloadProbe = { ...probe(), sidebarHtml: side };
  const r = buildResult({ run: s.run, nativeOn: nativeOn(), waitedMs: s.waitedMs, afterReply: s.afterReply, afterReload: afterReloadProbe });
  log(r.ok ? 'PASS' : `FAIL ${r.failed.join(', ')}`);
  await post(logText(r));
}

/** Run (or resume after the reload) the check for this run id. A finished run does nothing. */
export async function runUiTest(run: string): Promise<void> {
  const s = readSaved();
  try {
    if (s?.run === run) { if (s.phase === 'reload') await afterReload(s); return; }
    await beforeReload(run);
  } catch (e) {
    log(`error ${String(e)}`);
    await post(`uitest: native-chat run=${run} FAIL (error: ${String(e).slice(0, 200)})`);
  }
}

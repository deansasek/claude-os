// Claude in the Browser: a side panel that talks to a Claude session about the page open here, in the style of Claude
// in Chrome's panel. Each message carries the page's text (read through the browser tools' native bridge). The session
// answers in the panel; anything that needs approval (including the browser tools) shows a card here. Sessions, replies
// and approvals go through the Claude app's own routes (apps/claude/server/index.ts), so the PIN lock applies too.
import { esc, getJson, SPARK_SHAPE, store } from '../../../core/web/dom.ts';
import { markdown } from '../../../core/web/markdown.ts';
import { browser, voice } from '../../../core/web/device.ts';
import { call } from '../../claude/web/sessions/pin.ts';
import { createControls, loadModels, newDefaults, paintControls, remember, settingsFor, wantFor, type Controls } from '../../claude/web/sessions/controls.ts';
import type { Approval, ContextUse, History, HubTurn, NewSessionResult, Project, SessionSettings, SessionView, TranscriptEntry } from '../../claude/api.ts';
import { cur } from './state.ts';

const SPARK = `<svg viewBox="-50 -50 100 100" aria-hidden="true"><g fill="var(--clay)">${SPARK_SHAPE}</g></svg>`;
const PAGE_MARK = '\n\n---\n';   // separates what you wrote from the page's text, in the session's log too

type Row = { kind: 'user' | 'claude' | 'note'; html: string };

const el: Record<string, HTMLElement> = {};
let panel!: HTMLElement;
let content!: HTMLElement;
let onChange: () => void = () => {};
let rows: Row[] = [];
let statusHtml: string | null = null;   // what the session is doing right now (a step, or an approval card)
let sessionId: string | null = null;
let projectId: string | null = null;
let turnId: string | null = null;
let busy = false;
let timer = 0;
// the session's controls (model, effort, mode) and what the context ring shows; the same code as the Claude app's
let settings: SessionSettings = newDefaults();
let canReply = true;
let contextUse: ContextUse | null = null;
let ctl: Controls | null = null;

export const claudePanelOpen = (): boolean => !!panel && !panel.hidden;

/** Shows or hides the panel. The native page shrinks to the space left of it (the frame is fitted by the Browser). */
export function setClaudePanel(on: boolean): void {
  if (!panel) return;
  if (!on) ctl?.closeMenu();
  panel.hidden = !on;
  content.classList.toggle('cl-open', on);
  onChange();
  // the page fits to the panel once the panel has laid out; a second fit after that catches a late layout
  setTimeout(onChange, 120);
}

// ---------- the width: a divider on the panel's left edge drags it; the page fits beside it ----------
const WIDTH_KEY = 'browser.claudeWidth';
const MIN_W = 260, MAX_W = 600, DEFAULT_W = 340;

function setWidth(px: number): void {
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, px)));
  content.closest<HTMLElement>('#app-browser')?.style.setProperty('--cl-w', `${w}px`);
}

function loadWidth(): void {
  const saved = parseInt(store.get(WIDTH_KEY) || '', 10);
  setWidth(Number.isFinite(saved) ? saved : DEFAULT_W);
}

function startDrag(e: PointerEvent): void {
  e.preventDefault();
  const split = el.clSplit;
  split.setPointerCapture(e.pointerId);
  const box = content.getBoundingClientRect();
  const k = box.width / (content.offsetWidth || 1);   // screen px per CSS px (the stage is scaled to the screen)
  const move = (ev: PointerEvent): void => {
    setWidth((box.right - ev.clientX) / k);
    onChange();
  };
  const up = (): void => {
    split.removeEventListener('pointermove', move);
    split.removeEventListener('pointerup', up);
    split.removeEventListener('pointercancel', up);
    const w = content.closest<HTMLElement>('#app-browser')?.style.getPropertyValue('--cl-w') || '';
    if (w) store.set(WIDTH_KEY, String(parseInt(w, 10)));
    onChange();
  };
  split.addEventListener('pointermove', move);
  split.addEventListener('pointerup', up);
  split.addEventListener('pointercancel', up);
}

/** From the Browser's menu: open the panel and ask about the page open here (the page's text goes with the question). */
export function askAboutPage(question = 'What is on this page? Give me the short version, and the main things I might want to do here.'): void {
  if (!panel) return;
  setClaudePanel(true);
  const box = el.clText as HTMLTextAreaElement | undefined;
  if (!box) return;
  box.value = question;
  void send();
}

/**
 * Wires the panel and its bar button (brClaude). get(id) finds an element of the Browser app; changed() re-fits the
 * native page. If the page has no panel (an older copy of the Browser's markup), this does nothing and the Browser
 * still works: the panel must never stop the Browser app from starting.
 */
export function initClaudePanel(get: (id: string) => HTMLElement, changed: () => void): void {
  onChange = changed;
  const find = (id: string): HTMLElement | null => { try { return get(id); } catch { return null; } };
  const p = find('clPanel');
  if (!p || !p.parentElement) return;
  const ids = ['clBody', 'clText', 'clForm', 'clRecent', 'clList', 'clNew', 'clRecentBtn', 'clRecentClose', 'clClose', 'clSpark', 'clSend', 'clBarSpark', 'brClaude', 'clPlus', 'clMic'];
  const found: Record<string, HTMLElement> = {};
  for (const id of [...ids, 'clSplit']) {
    const e = find(id);
    if (!e) return;
    found[id] = e;
  }
  panel = p;
  content = p.parentElement;
  Object.assign(el, found);
  el.clSpark.innerHTML = SPARK;
  el.clBarSpark.innerHTML = SPARK;
  loadWidth();
  el.clSplit.addEventListener('pointerdown', startDrag);
  wireControls();
  wireMic();
  el.clPlus.addEventListener('click', () => note('Photos and files aren’t in the panel yet. Attach them from the Claude app for now.'));
  el.brClaude.addEventListener('click', () => setClaudePanel(!claudePanelOpen()));
  el.clClose.addEventListener('click', () => setClaudePanel(false));
  el.clNew.addEventListener('click', newChat);
  el.clRecentBtn.addEventListener('click', () => { void openRecent(); });
  el.clRecentClose.addEventListener('click', () => { el.clRecent.hidden = true; });
  el.clForm.addEventListener('submit', e => { e.preventDefault(); void send(); });
  el.clText.addEventListener('keydown', e => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.shiftKey) { k.preventDefault(); void send(); }
  });
  // approval buttons live in the conversation: one listener for all of them
  el.clBody.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-approval]');
    if (b) void answer(b.dataset.turn || '', b.dataset.approval || '', b.dataset.allow === '1');
  });
  el.clList.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-session]');
    if (b?.dataset.session) void openSession(b.dataset.session);
  });
  paint();
}

// ---------- the mic: dictate into the composer (the tablet's voice; the words land in the box, not as a request) ----------
let release: (() => void) | null = null;   // holding the next spoken request for the panel

function setListening(on: boolean): void {
  el.clMic?.classList.toggle('on', on);
  el.clMic?.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function stopDictation(cancel: boolean): void {
  release?.();
  release = null;
  setListening(false);
  if (cancel) void voice.cancel();
}

function dictate(): void {
  if (release) { stopDictation(true); return; }   // tapped again: stop
  release = voice.claimFinals(text => {
    // the spoken words go into the box, at its end, ready to send or to change
    const box = el.clText as HTMLTextAreaElement;
    const said = text.trim();
    if (said) box.value = box.value.trim() ? `${box.value.trimEnd()} ${said}` : said;
    stopDictation(false);
  });
  setListening(true);
  void voice.listen(8000);
}

function wireMic(): void {
  if (!el.clMic) return;
  if (!voice.available) return;   // no voice on this tablet: the mic stays hidden
  el.clMic.hidden = false;
  el.clMic.addEventListener('click', dictate);
  // if the tablet gives up listening (silence, cancel), the mic goes back to idle
  voice.on(e => { if (release && (e.type === 'timeout' || e.type === 'cancel')) stopDictation(false); });
}

// ---------- the chips: model, effort, mode and the context ring (the Claude app's own controls) ----------
function wireControls(): void {
  if (!panel) return;
  ctl = createControls();
  try {
    ctl.init(panel, panel, () => settings, pick, repaintControls, 'cl');
  } catch (e) {
    console.error('claude panel controls', e);   // the chips are optional: the panel still sends and reads
    ctl = null;
  }
  void loadModels();
  repaintControls();
}

/** A chip was picked: it is the new-session default when no session is open, or this session's next reply. */
function pick(change: Partial<SessionSettings>): void {
  settings = { ...settings, ...change };
  remember(sessionId, change);
  repaintControls();
}

function repaintControls(): void {
  if (!panel) return;
  paintControls(panel, { settings, context: contextUse, interactive: !sessionId || canReply, show: true }, 'cl');
}

// ---------- the page, as Claude sees it ----------
async function pageContext(): Promise<string> {
  const t = cur();
  if (!t || !t.url) return '';   // a Claude Home page (new tab, a message): nothing to read
  try {
    const p = await browser.readPage(t.id);
    return `Page open in the Browser: ${p.title || t.url}\n${p.url || t.url}\n\n${(p.text || '').slice(0, 6000)}`;
  } catch {
    return `Page open in the Browser: ${t.url}`;
  }
}

// ---------- sending and following a reply ----------
async function send(): Promise<void> {
  const box = el.clText as HTMLTextAreaElement;
  const text = box.value.trim();
  if (!text || busy) return;
  busy = true;
  box.value = '';
  rows.push({ kind: 'user', html: esc(text) });
  paint();
  try {
    const ctx = await pageContext();
    const msg = ctx ? `${text}${PAGE_MARK}${ctx}` : text;
    if (!sessionId) {
      if (projectId == null) {
        // a failed read is not an empty list: say the PC could not be reached, not that there is no folder
        let list: Project[];
        try { list = await getJson<Project[]>('/api/claude/projects'); }
        catch { throw new Error('Can’t reach your PC just now.'); }
        projectId = list[0]?.id ?? null;
      }
      if (!projectId) throw new Error('There’s no project folder on the PC to start in.');
      const r = await call<NewSessionResult>('new', { project: projectId, text: msg, model: settings.model, effort: settings.effort, mode: settings.mode });
      if (!r.ok || !r.sessionId) throw new Error(explain(r.error));
      sessionId = r.sessionId;
      turnId = null;   // the first turn of a new session: taken as it appears
    } else {
      const r = await call<{ ok: boolean; turn?: HubTurn; error?: string }>('reply', { id: sessionId, text: msg, ...wantFor(sessionId) });
      if (!r.ok || !r.turn) throw new Error(explain(r.error));
      turnId = r.turn.id;
    }
    watch();
  } catch (e) {
    note(explain((e as Error).message));
    finish();
  }
}

/** Polls the session until the turn finishes, showing its steps and any approval it asks for. */
function watch(): void {
  clearTimeout(timer);
  const tick = async (): Promise<void> => {
    if (!sessionId) { finish(); return; }
    let v: SessionView;
    try { v = await getJson<SessionView>(`/api/claude/session?id=${encodeURIComponent(sessionId)}`); }
    catch { timer = window.setTimeout(tick, 2000); return; }
    const t = v.turn;
    contextUse = v.context ?? null;   // the ring follows the session's context as it grows
    canReply = v.canReply;
    repaintControls();
    if (!t || (turnId && t.id !== turnId)) { timer = window.setTimeout(tick, 1200); return; }
    turnId ??= t.id;
    if (t.status === 'approval' && t.approval) {
      statusHtml = approvalCard(t.id, t.approval);
      paint();
      timer = window.setTimeout(tick, 1200);
      return;
    }
    if (t.status === 'running') {
      statusHtml = `<span class="cl-step">${esc(t.progress.at(-1) || 'Thinking…')}</span>`;
      paint();
      timer = window.setTimeout(tick, 1200);
      return;
    }
    statusHtml = null;
    const out = t.status === 'done' ? (t.reply || '') : t.status === 'stopped' ? 'Stopped.' : (t.error || 'Something went wrong.');
    if (t.status === 'done') rows.push({ kind: 'claude', html: markdown(out) });
    else note(out);
    finish();
  };
  void tick();
}

async function answer(turn: string, approval: string, allow: boolean): Promise<void> {
  try {
    const r = await call<{ ok: boolean; error?: string }>('approve', { turn, approval, allow });
    if (!r.ok) note(explain(r.error));
  } catch (e) {
    note(explain((e as Error).message));
  }
  statusHtml = null;   // the next poll brings whatever comes next
  paint();
}

function approvalCard(turn: string, a: Approval): string {
  const t = esc(turn), id = esc(a.id);
  return `<div class="cl-appr"><b>${esc(a.summary)}</b>${a.detail ? `<div class="cl-detail">${esc(a.detail)}</div>` : ''}`
    + `<div class="cl-appr-btns"><button class="cl-btn" data-turn="${t}" data-approval="${id}" data-allow="0">Deny</button>`
    + `<button class="cl-btn primary" data-turn="${t}" data-approval="${id}" data-allow="1">Allow</button></div></div>`;
}

// ---------- the conversation ----------
function note(text: string): void { rows.push({ kind: 'note', html: esc(text) }); paint(); }

function finish(): void {
  busy = false;
  paint();
}

function newChat(): void {
  clearTimeout(timer);
  sessionId = null;
  settings = newDefaults();   // a new session starts with the defaults you last picked
  canReply = true;
  contextUse = null;
  repaintControls();
  turnId = null;
  rows = [];
  statusHtml = null;
  busy = false;
  paint();
}

/** Reads a session's conversation back into the panel (its page text is not shown again). */
async function openSession(id: string): Promise<void> {
  el.clRecent.hidden = true;
  clearTimeout(timer);
  sessionId = id;
  turnId = null;
  statusHtml = null;
  busy = false;
  try {
    const v = await getJson<SessionView>(`/api/claude/session?id=${encodeURIComponent(id)}`);
    settings = settingsFor(id, v.settings);
    canReply = v.canReply;
    contextUse = v.context ?? null;
    rows = v.transcript.filter((e: TranscriptEntry) => e.kind === 'user' || e.kind === 'assistant').map((e: TranscriptEntry): Row =>
      e.kind === 'user' ? { kind: 'user', html: esc(e.text.split(PAGE_MARK)[0]) } : { kind: 'claude', html: markdown(e.text) });
  } catch {
    rows = [{ kind: 'note', html: 'Couldn’t open that session.' }];
    sessionId = null;
  }
  paint();
}

async function openRecent(): Promise<void> {
  el.clRecent.hidden = false;
  el.clList.innerHTML = '<div class="cl-muted">Loading…</div>';
  try {
    const h = await getJson<History>('/api/claude/history?limit=30');
    const items = h.groups.flatMap(g => g.items.map(i => ({ ...i, folder: g.name })));
    el.clList.innerHTML = items.length
      ? items.map(i => `<button class="cl-item" data-session="${esc(i.id)}"><span class="cl-item-t">${esc(i.title || 'Untitled')}</span><span class="cl-item-s">${esc(i.folder)}</span></button>`).join('')
      : '<div class="cl-muted">No sessions yet.</div>';
  } catch {
    el.clList.innerHTML = '<div class="cl-muted">Couldn’t load your sessions.</div>';
  }
}

function paint(): void {
  const body = el.clBody;
  const empty = !rows.length && !statusHtml;
  body.innerHTML = empty
    ? `<div class="cl-empty"><div class="cl-spark">${SPARK}</div>Ask about this page, or tell Claude what to do with it.</div>`
    : rows.map(r => `<div class="cl-msg ${r.kind}">${r.html}</div>`).join('')
      + (statusHtml ? `<div class="cl-msg status">${statusHtml}</div>` : '');
  body.scrollTop = body.scrollHeight;
  (el.clSend as HTMLButtonElement).disabled = busy;
  // no re-fit here: the panel's width is fixed, so only opening and closing it changes the page (setClaudePanel)
}

/** What a failure means to someone on the tablet. Unknown reasons come through as they are. */
function explain(reason: string | undefined): string {
  const r = reason || '';
  if (r === 'locked_out' || r.includes('locked')) return 'Unlock Claude on the tablet first, then try again.';
  const known: Record<string, string> = {
    not_found: 'That session is gone.',
    too_old: 'That session is too old to continue here.',
    open_on_pc: 'That session is open on the PC. Continue it there.',
    busy: 'Claude is busy with another session. Try again in a moment.',
    running: 'That session is still working.',
    too_many: 'Too many sessions are running right now.',
    no_pin: 'Set a PIN in Claude’s settings first.',
  };
  return known[r] || r || 'Something went wrong.';
}

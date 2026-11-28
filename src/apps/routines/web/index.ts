// The Routines app: list, edit, add and delete routines (a name, the phrases that run it, up to eight steps).
// The routines live on the tablet (web/sync.ts), so the app works with the PC off. The PC's copy (.routines.json,
// server/store.ts) is a sync target that Claude's tools also change; it checks every save again: names and phrases,
// the steps, and that a scene is on the Home Assistant dashboard or the Home screen. Running happens in web/run.ts
// (voice, the Home screen's tiles, Claude's run_routine, and Run now here all use it).
//
// Left, every routine (the first two are the Home screen's tiles). Right, the one being edited: tap the name or
// "+ Phrase" for ClaudeOS's keyboard; steps are added with the chips, moved with the arrows, and timers and pauses
// set with − and +. Nothing is saved until Save. A change here sends hub:routines, so Home and voice read them again.
import { esc, getJson, postJson } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { onBack } from '../../../core/web/system.ts';
import type { HaScenes } from '../../home-assistant/api.ts';
import {
  MAX_NAME, MAX_PAUSE_S, MAX_PHRASE, MAX_PHRASES, MAX_ROUTINES, MAX_SAY, MAX_STEPS, cleanRoutine, cleanText, stepLabel,
  type Routine, type RoutineTime, type RoutinesResult, type Step, type StepKind,
} from '../api.ts';
import { manifest } from '../manifest.ts';
import { HOME_ROUTINES } from './local.ts';
import { onRunState, runState, startRoutine, stopRoutine } from './run.ts';
import { apply, hasCopy, localRoutines, onCopyChange, pull } from './sync.ts';

const API = `/api/${manifest.id}`;
const TIMER_LADDER = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];

const svg = (d: string, w = 1.9) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = appIcon('routines');
const X = svg('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>');
const UP = svg('<path d="M5 12l5-5 5 5"/>');
const DOWN = svg('<path d="M5 8l5 5 5-5"/>');
const MINUS = svg('<path d="M5 10h10"/>', 2.2);
const PLUS = svg('<path d="M10 5v10M5 10h10"/>', 2.2);

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

interface Draft { id: string | null; name: string; phrases: string[]; steps: Step[]; at: RoutineTime | null }
let routines: Routine[] = [];
let loaded = false;
let draft: Draft = blank();
let saved = '';                  // the draft as last loaded or saved, to tell whether it changed
let note = '';
let refreshNote = '';            // the note a failed refresh set; a later good refresh clears only that note
let busy = false;
let sheetOpen = false;
let scenes: { entity_id: string; name: string }[] = [];   // the ones a routine may set (on the dashboard or the Home screen)
let scenesWhy: 'ok' | 'not_set_up' | 'error' | null = null;   // the status of the last scenes read, to say why the list is empty

function blank(): Draft { return { id: null, name: '', phrases: [], steps: [], at: null }; }
const snap = (d: Draft) => JSON.stringify({ n: d.name, p: d.phrases, s: d.steps, a: d.at });
const dirty = () => snap(draft) !== saved;
const sceneName = (id: string) => scenes.find(s => s.entity_id === id)?.name;
const changed = () => dispatchEvent(new CustomEvent('hub:routines'));

function edit(r: Routine | null): void {
  draft = r ? { id: r.id, name: r.name, phrases: [...r.phrases], steps: r.steps.map(s => ({ ...s })), at: r.at ? { ...r.at, days: [...r.at.days] } : null } : blank();
  saved = snap(draft);
  note = '';
  render();
  $('rtScroll').scrollTop = 0;
}

// ---------- talking to the PC ----------
const LIST_TIMEOUT_MS = 10e3;    // a list the PC never answers gives up, so the page shows its note
const WRITE_TIMEOUT_MS = 15e3;   // a save or delete the PC never answers gives up, so Save and Delete work again

async function refresh(): Promise<void> {
  try {
    if (hasCopy()) { await pull(); routines = localRoutines() ?? routines; loaded = true; if (note === refreshNote) note = ''; refreshNote = ''; }   // the copy, with Claude's edits
    else {
      const r = await getJson<RoutinesResult>(`${API}/list`, LIST_TIMEOUT_MS);   // the first run: the PC's routines, until the copy exists
      if (Array.isArray(r?.routines)) { routines = r.routines; loaded = true; if (note === refreshNote) note = ''; refreshNote = ''; }
      if (!r.ok && r.error) note = refreshNote = r.error;
    }
    if (!dirty()) {   // nothing typed yet: show the saved one (or the first)
      const cur = draft.id ? routines.find(x => x.id === draft.id) : null;
      if (cur) edit(cur); else if (!draft.id && !draft.name && !draft.steps.length && routines[0]) edit(routines[0]);
    }
  } catch {
    if (!loaded) note = refreshNote = 'Couldn’t reach the PC. Trying again when you come back.';
    // No local copy: the routines shown are the PC's, so say they may be old. A save or delete error stays on screen.
    else if (!hasCopy() && (note === '' || note === refreshNote)) note = refreshNote = 'Couldn’t reach the PC, so these may be out of date. Trying again when you come back.';
  }
  render();
}

// a scene read the PC never answers gives up; each read takes a number, and only the newest read sets the picker
const SCENES_TIMEOUT_MS = 20e3;
let scenesSeq = 0;
async function loadScenes(): Promise<void> {
  const seq = ++scenesSeq;
  try {
    const r = await getJson<HaScenes>('/api/home-assistant/scenes', SCENES_TIMEOUT_MS);
    if (seq !== scenesSeq) return;   // a newer read came first: its answer is the one that counts
    scenesWhy = r?.status ?? 'error';
    if (r?.status === 'ok') scenes = r.scenes.filter(s => s.dashboard || s.home).map(s => ({ entity_id: s.entity_id, name: s.name }));
  } catch { if (seq !== scenesSeq) return; scenesWhy = 'error'; /* keep the last list */ }
  render();
}

async function save(): Promise<void> {
  if (busy) return;
  const c = cleanRoutine(draft);
  if ('error' in c) { note = c.error; render(); return; }
  const routine: Record<string, unknown> = { ...(draft.id ? { id: draft.id } : {}), ...c };
  const mine = apply({ path: 'save', body: { routine } });   // the tablet's copy: shows at once, sent to the PC later
  if (mine) {
    if (mine.ok) { routines = mine.routines; edit(routines.find(x => x.id === routine.id) ?? null); }
    else note = mine.error ?? 'That didn’t save.';
    render();
    return;
  }
  busy = true; render();
  try {
    const r = await postJson<RoutinesResult>(`${API}/save`, { routine }, WRITE_TIMEOUT_MS);
    if (Array.isArray(r?.routines)) routines = r.routines;
    if (r?.ok) {
      const mine = routines.find(x => x.id === r.id);
      edit(mine ?? null);
      changed();
    } else note = r?.error ?? 'That didn’t save.';
  } catch { note = 'Couldn’t reach the PC. Try again in a moment.'; }
  busy = false; render();
}

async function remove(id: string): Promise<void> {
  if (busy) return;   // a save or delete is still in flight: a second Delete would race it and overwrite routines with stale data
  const mine = apply({ path: 'delete', body: { id } });
  if (mine) { routines = mine.routines; edit(routines[0] ?? null); render(); return; }
  busy = true; render();
  try {
    const r = await postJson<RoutinesResult>(`${API}/delete`, { id }, WRITE_TIMEOUT_MS);
    if (Array.isArray(r?.routines)) routines = r.routines;
    if (r?.ok) { edit(routines[0] ?? null); changed(); } else note = r?.error ?? 'That didn’t delete.';
  } catch { note = 'Couldn’t reach the PC. Try again in a moment.'; }
  busy = false; render();
}

// ---------- drawing ----------
function cardHtml(r: Routine, i: number): string {
  const run = runState();
  const on = run?.id === r.id;
  const sub = on ? `Running · step ${run.step} of ${run.of}`
    : [`${r.steps.length} step${r.steps.length === 1 ? '' : 's'}`, ...r.phrases.slice(0, 2).map(p => `“${p}”`)].join(' · ');
  return `<li><button class="rt-card${r.id === draft.id ? ' on' : ''}${on ? ' running' : ''}" data-id="${esc(r.id)}">`
    + `<b>${esc(r.name)}</b><span class="rt-sub">${esc(sub)}</span>${i < HOME_ROUTINES ? '<span class="rt-home">On Home</span>' : ''}</button></li>`;
}

function stepHtml(s: Step, i: number, n: number): string {
  const sceneMissing = s.kind === 'scene' && loaded && scenes.length > 0 && !sceneName(s.entity_id);
  let main: string;
  if (s.kind === 'say' || s.kind === 'scene' || s.kind === 'quiet') {
    main = `<button class="rt-step-main" data-act="edit"><span class="rt-step-text">${esc(stepLabel(s, s.kind === 'scene' ? sceneName(s.entity_id) : undefined))}`
      + `${sceneMissing ? ' (not on Home now)' : ''}</span></button><span class="rt-step-edit">Change</span>`;
  } else if (s.kind === 'timer' || s.kind === 'pause') {
    const v = s.kind === 'timer' ? `${s.minutes} min` : `${s.seconds} s`;
    main = `<span class="rt-step-main"><span class="rt-step-text">${s.kind === 'timer' ? 'Start a timer' : 'Pause'}</span></span>`
      + `<span class="rt-stepper"><button class="rt-icon-btn" data-act="less" aria-label="Less">${MINUS}</button><output>${v}</output>`
      + `<button class="rt-icon-btn" data-act="more" aria-label="More">${PLUS}</button></span>`;
  } else main = `<span class="rt-step-main"><span class="rt-step-text">${esc(stepLabel(s))}</span></span>`;
  return `<li class="rt-step${sceneMissing ? ' bad' : ''}" data-i="${i}">${main}`
    + `<button class="rt-icon-btn" data-act="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${UP}</button>`
    + `<button class="rt-icon-btn" data-act="down" aria-label="Move down"${i === n - 1 ? ' disabled' : ''}>${DOWN}</button>`
    + `<button class="rt-icon-btn del" data-act="remove" aria-label="Remove this step">${X}</button></li>`;
}

function render(): void {
  if (!ctx) return;
  $('rtList').innerHTML = routines.length ? routines.map(cardHtml).join('')
    : `<li class="rt-empty">${loaded ? '<em>No routines yet.</em><span>Tap New routine to make one.</span>' : 'Loading…'}</li>`;
  ($('rtNew') as HTMLButtonElement).disabled = routines.length >= MAX_ROUTINES;

  const n = $('rtNote');
  n.hidden = !note;
  n.textContent = note;

  const name = $('rtName');
  name.textContent = draft.name || 'Name this routine';
  name.classList.toggle('empty', !draft.name);

  $('rtPhrases').innerHTML = draft.phrases.map((p, i) =>
    `<span class="rt-chip" data-i="${i}">“${esc(p)}”<button class="rt-x" data-act="phrase-x" aria-label="Remove ${esc(p)}">${X}</button></span>`).join('')
    + (draft.phrases.length < MAX_PHRASES ? '<button class="rt-chip add" data-act="phrase-add">+ Phrase</button>' : '');

  $('rtTime').innerHTML = timeHtml();
  $('rtCount').textContent = `· ${draft.steps.length} of ${MAX_STEPS}`;
  $('rtSteps').innerHTML = draft.steps.map((s, i) => stepHtml(s, i, draft.steps.length)).join('');
  ctx.root.querySelectorAll<HTMLButtonElement>('#rtAdd [data-add]').forEach(b => { b.disabled = draft.steps.length >= MAX_STEPS; });

  const run = runState();
  const runBtn = $('rtRun') as HTMLButtonElement;
  runBtn.textContent = run && run.id === draft.id ? 'Stop' : 'Run now';
  runBtn.disabled = !draft.id || (dirty() && !(run && run.id === draft.id));
  const saveBtn = $('rtSave') as HTMLButtonElement;
  saveBtn.disabled = busy || !dirty();
  saveBtn.textContent = busy ? 'Saving…' : draft.id ? 'Save' : 'Add routine';
  const del = $('rtDelete') as HTMLButtonElement;
  del.hidden = !draft.id;
  del.disabled = busy;   // greyed while a save or delete is in flight
}

// ---------- editing ----------
function editName(): void {
  Keyboard.open({
    value: draft.name, placeholder: 'Name, like “Good morning”', done: 'Done', autoCap: true, max: MAX_NAME,
    onDone: text => { draft.name = cleanText(text).slice(0, MAX_NAME); note = ''; render(); },
  });
}

// ---------- running by itself at a time ----------
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AT_PRESETS: [number, number][] = [[6, 0], [6, 30], [7, 0], [7, 30], [8, 0], [12, 0], [18, 0], [19, 0], [20, 0], [21, 0]];
const hm = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** The row under the steps: "+ Run at a time", or the time and the days it runs on (none lit = every day). */
function timeHtml(): string {
  const at = draft.at;
  if (!at) return '<button class="rt-chip add" data-act="at-add">+ Run at a time</button>';
  const every = !at.days.length;
  return `<button class="rt-chip on" data-act="at-edit">${hm(at.h, at.m)}</button>`
    + DAY_SHORT.map((d, i) => `<button class="rt-chip${every || at.days.includes(i) ? ' on' : ''}" data-day="${i}">${d}</button>`).join('')
    + `<button class="rt-chip" data-act="at-x" aria-label="Don’t run by itself">${X}</button>`;
}

function timeSheet(): void {
  openSheet('<h3>Run at what time?</h3><p>On the tablet, once a day, within an hour of the time.</p>'
    + `<div class="rt-pick">${AT_PRESETS.map(([h, m]) => `<button class="rt-btn" data-h="${h}" data-m="${m}">${hm(h, m)}</button>`).join('')}</div>`
    + '<div class="rt-sheet-btns"><button class="rt-btn" data-act="cancel">Cancel</button></div>', b => {
    const h = Number(b.dataset.h), m = Number(b.dataset.m);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    draft.at = { h, m, days: draft.at?.days ?? [] };
    render();
  });
}

function onTimeClick(ev: Event): void {
  const b = (ev.target as Element).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.act === 'at-add' || b.dataset.act === 'at-edit') { timeSheet(); return; }
  if (b.dataset.act === 'at-x') { draft.at = null; render(); return; }
  if (b.dataset.day == null || !draft.at) return;
  const i = Number(b.dataset.day);
  const current = draft.at.days.length ? [...draft.at.days] : [0, 1, 2, 3, 4, 5, 6];
  const next = current.includes(i) ? current.filter(d => d !== i) : [...current, i].sort((a, c) => a - c);
  if (!next.length) return;   // at least one day; all seven is the same as every day
  draft.at = { ...draft.at, days: next.length === 7 ? [] : next };
  render();
}

function addPhrase(): void {
  if (draft.phrases.length >= MAX_PHRASES) return;
  Keyboard.open({
    placeholder: 'What you’ll say, like “good morning”', done: 'Add', max: MAX_PHRASE,
    onDone: text => {
      const t = cleanText(text).slice(0, MAX_PHRASE);
      if (t && !draft.phrases.some(p => p.toLowerCase() === t.toLowerCase())) draft.phrases.push(t);
      note = ''; render();
    },
  });
}

function editSay(i: number | null): void {
  const cur = i != null ? draft.steps[i] : null;
  Keyboard.open({
    value: cur?.kind === 'say' ? cur.text : '', placeholder: 'What to say', done: i == null ? 'Add' : 'Done', autoCap: true, max: MAX_SAY,
    onDone: text => {
      const t = cleanText(text).slice(0, MAX_SAY);
      if (!t) return;
      if (i == null) { if (draft.steps.length < MAX_STEPS) draft.steps.push({ kind: 'say', text: t }); }
      else draft.steps[i] = { kind: 'say', text: t };
      render();
    },
  });
}

function pickScene(i: number | null): void {
  void loadScenes();
  const why = scenesWhy === 'not_set_up' ? 'Home Assistant isn’t set up yet. Set it up in the Home Assistant app first.'
    : scenesWhy === 'error' ? 'Your scenes can’t be read just now. Try again in a moment.'
    : 'No scenes are on the Home screen or the Home Assistant dashboard yet. Add one in Home Assistant first; then it can go in a routine.';
  const list = scenes.length
    ? `<div class="rt-pick">${scenes.map(s => `<button class="rt-btn" data-scene="${esc(s.entity_id)}">${esc(s.name)}</button>`).join('')}</div>`
    : `<p>${why}</p>`;
  openSheet(`<h3>Pick a scene</h3><p>Only scenes on the Home screen or the dashboard can be set by a routine.</p>${list}`
    + '<div class="rt-sheet-btns"><button class="rt-btn" data-act="cancel">Cancel</button></div>', b => {
    const id = b.dataset.scene;
    if (!id) return;
    if (i == null) { if (draft.steps.length < MAX_STEPS) draft.steps.push({ kind: 'scene', entity_id: id }); }
    else draft.steps[i] = { kind: 'scene', entity_id: id };
    render();
  });
}

function addStep(kind: StepKind, mode?: string): void {
  if (draft.steps.length >= MAX_STEPS) return;
  if (kind === 'say') { editSay(null); return; }
  if (kind === 'scene') { pickScene(null); return; }
  draft.steps.push(kind === 'timer' ? { kind, minutes: 5 } : kind === 'pause' ? { kind, seconds: 3 } : kind === 'lists' ? { kind, list: 'shopping' } : kind === 'quiet' ? { kind, on: true }
    : kind === 'focus' ? { kind, mode: mode === 'family' || mode === 'sleep' ? mode : 'work' } : { kind } as Step);
  render();
}

function bump(i: number, up: boolean): void {
  const s = draft.steps[i];
  if (s?.kind === 'pause') s.seconds = Math.max(1, Math.min(MAX_PAUSE_S, s.seconds + (up ? 1 : -1)));
  else if (s?.kind === 'timer') {
    const at = TIMER_LADDER.findIndex(v => v >= s.minutes);
    const k = at < 0 ? TIMER_LADDER.length - 1 : at;
    s.minutes = up ? TIMER_LADDER[Math.min(TIMER_LADDER.length - 1, TIMER_LADDER[k] > s.minutes ? k : k + 1)] : TIMER_LADDER[Math.max(0, k - 1)];
  }
  render();
}

function onStepsClick(ev: Event): void {
  const b = (ev.target as Element).closest<HTMLElement>('[data-act]');
  const li = b?.closest<HTMLElement>('.rt-step');
  if (!b || !li) return;
  const i = +(li.dataset.i ?? -1), s = draft.steps[i];
  if (!s) return;
  switch (b.dataset.act) {
    case 'up': if (i > 0) [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]; break;
    case 'down': if (i < draft.steps.length - 1) [draft.steps[i + 1], draft.steps[i]] = [draft.steps[i], draft.steps[i + 1]]; break;
    case 'remove': draft.steps.splice(i, 1); break;
    case 'less': bump(i, false); return;
    case 'more': bump(i, true); return;
    case 'edit':
      if (s.kind === 'say') editSay(i);
      else if (s.kind === 'scene') pickScene(i);
      else if (s.kind === 'quiet') { s.on = !s.on; render(); }   // a tap turns Do Not Disturb on or off
      return;
  }
  render();
}

// ---------- the sheet ----------
let onPick: ((b: HTMLElement) => void) | null = null;
function openSheet(html: string, pick: (b: HTMLElement) => void): void {
  $('rtSheetCard').innerHTML = html;
  onPick = pick;
  $('rtSheet').hidden = false;
  sheetOpen = true;
}
function closeSheet(): void { sheetOpen = false; onPick = null; if (ctx) $('rtSheet').hidden = true; }
function onSheetClick(ev: Event): void {
  const t = ev.target as HTMLElement;
  if (t === $('rtSheet')) { closeSheet(); return; }
  const b = t.closest<HTMLElement>('button');
  if (!b) return;
  const pick = onPick;
  closeSheet();
  if (b.dataset.act !== 'cancel') pick?.(b);
}

/** Leaving unsaved changes asks first. */
function leave(then: () => void): void {
  if (!dirty()) { then(); return; }
  openSheet('<h3>Discard your changes?</h3><p>What you changed in this routine hasn’t been saved.</p>'
    + '<div class="rt-sheet-btns"><button class="rt-btn" data-act="cancel">Keep editing</button><button class="rt-btn danger" data-act="go">Discard</button></div>',
  () => then());
}

function askDelete(): void {
  const id = draft.id;
  if (!id) return;
  openSheet(`<h3>Delete ${esc(draft.name || 'this routine')}?</h3><p>This can’t be undone.</p>`
    + '<div class="rt-sheet-btns"><button class="rt-btn" data-act="cancel">Cancel</button><button class="rt-btn danger" data-act="delete">Delete</button></div>',
  () => { void remove(id); });
}

function runNow(): void {
  const run = runState();
  if (run && run.id === draft.id) { stopRoutine(); return; }
  if (!draft.id || dirty()) return;
  void startRoutine(draft.id).then(res => {
    if (res === 'started') return;
    if (res === 'gone') { note = 'That routine is gone.'; void refresh(); return; }   // refresh() paints the note and drops the card
    if (res === 'empty') { note = 'That routine has no steps yet.'; render(); return; }
    if (res === 'offline') { note = 'The PC isn’t answering, so that routine can’t start.'; render(); return; }
    note = 'That routine couldn’t start. Try again in a moment.'; render();
  });
}

// ---------- the app ----------
const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount(c) {
    ctx = c;
    $('rtList').addEventListener('click', ev => {
      const id = (ev.target as Element).closest<HTMLElement>('[data-id]')?.dataset.id;
      if (!id || id === draft.id) return;
      leave(() => edit(routines.find(r => r.id === id) ?? null));
    });
    $('rtNew').addEventListener('click', () => { if (routines.length < MAX_ROUTINES) leave(() => { edit(null); editName(); }); });
    $('rtName').addEventListener('click', editName);
    $('rtTime').addEventListener('click', onTimeClick);
    $('rtPhrases').addEventListener('click', ev => {
      const b = (ev.target as Element).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'phrase-add') addPhrase();
      else if (b?.dataset.act === 'phrase-x') {
        const i = +(b.closest<HTMLElement>('[data-i]')?.dataset.i ?? -1);
        if (i >= 0) { draft.phrases.splice(i, 1); render(); }
      }
    });
    $('rtSteps').addEventListener('click', onStepsClick);
    $('rtAdd').addEventListener('click', ev => {
      const chip = (ev.target as Element).closest<HTMLElement>('[data-add]');
      const k = chip?.dataset.add as StepKind | undefined;
      if (k) addStep(k, chip?.dataset.mode);
    });
    $('rtSave').addEventListener('click', () => { void save(); });
    $('rtDelete').addEventListener('click', askDelete);
    $('rtRun').addEventListener('click', runNow);
    $('rtSheet').addEventListener('click', onSheetClick);
    onBack(() => {
      if (!ctx.isVisible() || Keyboard.isOpen || !sheetOpen) return false;
      closeSheet();
      return true;
    }, 10);
    onRunState(() => render());
    onCopyChange(() => { if (hasCopy()) { routines = localRoutines() ?? routines; loaded = true; render(); } });
    render();
  },
  onShow() { void refresh(); void loadScenes(); },
  onHide() {
    closeSheet();
    if (Keyboard.isOpen) Keyboard.close('nav');
  },
};
export default app;

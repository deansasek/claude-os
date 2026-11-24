// The Recipes app: recipes saved on this tablet (the store helper), a list and a detail view, and cook mode with large
// text and named timers (the Clock app's timer text, clock/web/timer-text.ts).
// Create with Claude sends a fixed prompt (recipe.ts) into the tablet's Claude chat (claude/web/native.ts). The reply
// is read when it arrives. A recipe is saved only after the user taps Save; a reply that is not JSON can be saved as text.
import { esc, onStore, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { alertFor, openApp } from '../../../core/web/system.ts';
import { dur, lengthWords } from '../../clock/web/timer-text.ts';
import { nativeBusy, nativeOn, nativeSend, nativeView } from '../../claude/web/native.ts';
import { manifest } from '../manifest.ts';
import { RECIPE_PROMPT, cookStep, parseRecipe, textRecipe, toRecipe, type Recipe } from './recipe.ts';

const LIST_KEY = 'recipes.list';
const PENDING_KEY = 'recipes.pending';   // when the last Create with Claude was sent (ISO time)
const TIMERS_KEY = 'recipes.timers';
const TIMER_MINUTES = [5, 10, 15, 30];
const ICON = appIcon('recipes');

interface CookTimer { id: string; name: string; end: number }
type Draft = { kind: 'recipe'; recipe: Recipe } | { kind: 'text'; text: string };
type Screen = { t: 'list' } | { t: 'detail'; i: number } | { t: 'cook'; i: number; step: number };

let ctx: AppContext | undefined;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx!.$<T>(id);
const readJson = <T>(k: string, fallback: T): T => {
  try { return (JSON.parse(store.get(k) || 'null') as T | null) ?? fallback; } catch { return fallback; }
};

let recipes: Recipe[] = readJson<unknown[]>(LIST_KEY, []).map(toRecipe).filter((r): r is Recipe => r !== null);
let screen: Screen = { t: 'list' };
let pending: string | null = store.get(PENDING_KEY);
let draft: Draft | null = null;          // a reply waiting for Save or Discard
let msg = '';
let confirmDelete = false;
let timers: CookTimer[] = readJson<CookTimer[]>(TIMERS_KEY, []);
let tick: number | undefined;

const saveRecipes = (): void => store.set(LIST_KEY, JSON.stringify(recipes));
const saveTimers = (): void => store.set(TIMERS_KEY, JSON.stringify(timers));
const meta = (r: Recipe): string => [r.serves && `Serves ${r.serves}`, r.time].filter(Boolean).join(' · ');
const msgHtml = (): string => (msg ? `<p class="rc-msg">${esc(msg)}</p>` : '');

function setPending(at: string | null): void {
  pending = at;
  store.set(PENDING_KEY, at);
}

/** Looks for Claude's reply to the Create with Claude message. Runs on every store change and when the app opens. */
function checkReply(): void {
  if (!ctx || !pending || nativeBusy()) return;
  const since = Date.parse(pending);
  const reply = nativeView().transcript.filter(e => e.kind === 'assistant' && e.at && Date.parse(e.at) >= since).pop();
  setPending(null);
  if (!reply) {
    msg = 'Claude did not reply. Try again.';
  } else {
    const parsed = parseRecipe(reply.text);
    draft = parsed.ok ? { kind: 'recipe', recipe: parsed.recipe } : { kind: 'text', text: reply.text };
  }
  render();
}

function createWithClaude(): void {
  msg = '';
  if (!nativeOn()) {
    msg = 'Turn on “Run Claude chats on this tablet” under Settings, Apps, Claude, then try again.';
  } else if (nativeBusy()) {
    msg = 'Claude is still answering a chat. Try again when it finishes.';
  } else {
    try {
      nativeSend(RECIPE_PROMPT);
      setPending(new Date().toISOString());
      openApp('claude');
    } catch {
      msg = 'Claude could not start on this tablet.';
    }
  }
  render();
}

function keep(r: Recipe): void {
  recipes = [r, ...recipes];
  saveRecipes();
  draft = null;
  confirmDelete = false;
  screen = { t: 'detail', i: 0 };
}

// ---------- cook-mode timers (named, kept across reloads) ----------
function timerLeft(t: CookTimer): string {
  const left = t.end - Date.now();
  return left > 0 ? `${dur(left)} left` : 'Done';
}

function timersHtml(): string {
  if (!timers.length) return '';
  const rows = timers.map(t => `<li class="rc-row rc-timer"><span class="rc-name">${esc(t.name)}</span><span class="rc-sub">${esc(timerLeft(t))}</span>`
    + `<button class="rc-btn" data-act="stop-timer" data-id="${esc(t.id)}">Stop</button></li>`).join('');
  return `<h3 class="rc-h">Timers</h3><ul class="rc-list">${rows}</ul>`;
}

function paintTimers(): void {
  const el = ctx?.root.querySelector('[data-timers]');
  if (el) el.innerHTML = timersHtml();
}

function addTimer(name: string, ms: number): void {
  timers = [...timers, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, end: Date.now() + ms }];
  saveTimers();
  ensureTick();
}

function ensureTick(): void {
  if (timers.length && tick == null) tick = window.setInterval(onTick, 1000);
}

function onTick(): void {
  const now = Date.now();
  const done = timers.filter(t => t.end <= now);
  if (done.length) {
    timers = timers.filter(t => t.end > now);
    saveTimers();
    for (const t of done) {
      alertFor('timer', { title: `${t.name} is done`, body: 'Recipes · cook mode', app: manifest.id }, undefined, !!ctx?.isVisible());
    }
  }
  if (!timers.length && tick != null) {
    clearInterval(tick);
    tick = undefined;
  }
  if (done.length) render(); else paintTimers();
}

// ---------- the screens ----------
function listHtml(): string {
  const waiting = pending
    ? `<section class="rc-card"><b>Waiting for Claude’s recipe…</b><p class="rc-sub">The reply shows here when it arrives.</p>`
      + `<div class="rc-actions"><button class="rc-btn" data-act="cancel-wait">Cancel</button></div></section>`
    : '';
  const rows = recipes.map((r, i) => `<li><button class="rc-row" data-act="open" data-i="${i}">`
    + `<span class="rc-name">${esc(r.name)}</span><span class="rc-sub">${esc(meta(r)) || '&nbsp;'}</span></button></li>`).join('');
  const empty = recipes.length || pending ? '' : '<p class="rc-empty">No recipes yet. Tap Create with Claude to make one.</p>';
  return `${msgHtml()}${waiting}<ul class="rc-list">${rows}</ul>${empty}`;
}

function draftHtml(d: Draft): string {
  if (d.kind === 'recipe') {
    const r = d.recipe;
    return `<section class="rc-card"><span class="rc-kicker">Claude’s recipe</span><h2 class="rc-title">${esc(r.name)}</h2>`
      + `<p class="rc-sub">${esc(meta(r)) || 'No serves or time given'} · ${r.ingredients.length} ingredients · ${r.steps.length} steps</p>`
      + `<div class="rc-actions"><button class="rc-btn pri" data-act="save-draft">Save recipe</button>`
      + `<button class="rc-btn" data-act="discard-draft">Not this one</button></div></section>`;
  }
  return `<section class="rc-card"><span class="rc-kicker">Claude’s reply</span>`
    + `<p class="rc-sub">This reply is not a recipe this app can read. Save it as text, or discard it.</p>`
    + `<div class="rc-text">${esc(d.text)}</div>`
    + `<div class="rc-actions"><button class="rc-btn pri" data-act="save-draft">Save as text</button>`
    + `<button class="rc-btn" data-act="discard-draft">Discard</button></div></section>`;
}

function detailHtml(i: number): string {
  const r = recipes[i];
  const ings = r.ingredients.map(g => `<li><span class="rc-amt">${esc(g.amount)}</span> ${esc(g.item)}</li>`).join('');
  const steps = r.steps.map(s => `<li>${esc(s)}</li>`).join('');
  return `${msgHtml()}<div class="rc-top"><button class="rc-btn" data-act="list">Back</button></div>`
    + `<h2 class="rc-title">${esc(r.name)}</h2><p class="rc-sub">${esc(meta(r))}</p>`
    + `<div class="rc-actions"><button class="rc-btn pri" data-act="cook" data-i="${i}">Start cooking</button>`
    + `<button class="rc-btn danger" data-act="delete">${confirmDelete ? 'Tap again to delete' : 'Delete'}</button></div>`
    + `<h3 class="rc-h">Ingredients</h3><ul class="rc-ings">${ings || '<li class="rc-sub">None listed.</li>'}</ul>`
    + `<h3 class="rc-h">Steps</h3><ol class="rc-steps">${steps}</ol>`;
}

function cookHtml(i: number, step: number): string {
  const r = recipes[i], s = cookStep(r, step);
  const presets = TIMER_MINUTES.map(m => `<button class="rc-btn" data-act="timer" data-min="${m}">${lengthWords(m * 60e3)}</button>`).join('');
  return `<div class="rc-top"><button class="rc-btn" data-act="detail" data-i="${i}">Exit cook mode</button>`
    + `<span class="rc-sub">${esc(r.name)}</span></div>`
    + `<p class="rc-kicker">${esc(s.heading)}</p><p class="rc-cook">${esc(s.text)}</p>`
    + `<div class="rc-actions"><button class="rc-btn big" data-act="step" data-d="-1" ${s.first ? 'disabled' : ''}>Previous</button>`
    + `<button class="rc-btn big pri" data-act="step" data-d="1" ${s.last ? 'disabled' : ''}>Next</button></div>`
    + `<div class="rc-timers-add"><span class="rc-sub">Timer for this step</span><div class="rc-actions">${presets}</div></div>`
    + `<div data-timers>${timersHtml()}</div>`;
}

function body(): string {
  const top = draft ? draftHtml(draft) : '';
  if (screen.t === 'detail') return top + detailHtml(screen.i);
  if (screen.t === 'cook') return top + cookHtml(screen.i, screen.step);
  return top + listHtml();
}

function render(): void {
  if (!ctx) return;
  if (screen.t !== 'list' && !recipes[screen.i]) screen = { t: 'list' };
  $('rcBody').innerHTML = body();
  $('rcCreate').hidden = screen.t !== 'list' || !!draft;
}

function onClick(ev: Event): void {
  const b = (ev.target as Element).closest<HTMLElement>('[data-act]');
  if (!b) return;
  const i = Number(b.dataset.i);
  msg = '';
  switch (b.dataset.act) {
    case 'save-draft':
      if (draft) keep(draft.kind === 'recipe' ? draft.recipe : textRecipe(draft.text));
      break;
    case 'discard-draft': draft = null; break;
    case 'cancel-wait': setPending(null); break;
    case 'list': screen = { t: 'list' }; confirmDelete = false; break;
    case 'open': screen = { t: 'detail', i }; confirmDelete = false; break;
    case 'detail': screen = { t: 'detail', i }; break;
    case 'cook': screen = { t: 'cook', i, step: 0 }; break;
    case 'step':
      if (screen.t === 'cook') screen = { ...screen, step: cookStep(recipes[screen.i], screen.step + Number(b.dataset.d)).index };
      break;
    case 'timer':
      if (screen.t === 'cook') addTimer(`Step ${screen.step + 1}`, Number(b.dataset.min) * 60e3);
      break;
    case 'stop-timer':
      timers = timers.filter(t => t.id !== b.dataset.id);
      saveTimers();
      break;
    case 'delete':
      if (screen.t !== 'detail') break;
      if (!confirmDelete) { confirmDelete = true; break; }
      const gone = screen.i;
      recipes = recipes.filter((_, k) => k !== gone);
      saveRecipes();
      screen = { t: 'list' };
      confirmDelete = false;
      break;
  }
  render();
}

const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount(c) {
    ctx = c;
    $('rcCreate').addEventListener('click', createWithClaude);
    $('rcBody').addEventListener('click', onClick);
    ensureTick();
    render();
  },
  onShow() {
    checkReply();
    render();
  },
};

// Claude's reply is in the tablet chat's store entry; any store write may mean it has arrived.
onStore(() => checkReply());

export default app;

// The Recipes app: one themed page. Discover has a large search over TheMealDB (through the hub, /api/recipes/), today's
// pick from the saved recipes, the saved recipes, and recipe cards with photos and a heart to save. A recipe page has
// the photo, the ingredients, numbered steps, Start cooking, and Claude on top. Cook mode has large text and named
// timers (the Clock app's timer text, clock/web/timer-text.ts). Saved recipes stay on this tablet (the store helper).
// Adapt with Claude, Suggest for tonight and Create with Claude send a prompt (recipe.ts) into the tablet's Claude chat
// (claude/web/native.ts). The reply is read when it arrives. A recipe is saved only after the user taps Save; a reply
// that is not JSON can be saved as text.
import { esc, getJson, onStore, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { alertFor, openApp } from '../../../core/web/system.ts';
import { dur, lengthWords } from '../../clock/web/timer-text.ts';
import { nativeBusy, nativeOn, nativeSend, nativeView } from '../../claude/web/native.ts';
import type { IngredientsResult, MealsResult, PantryResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { PANTRY_MAX } from './pantry.ts';
import {
  RECIPE_PROMPT, adaptPrompt, cookStep, fromStored, pantryPrompt, parseRecipe, recipeOfDay, textRecipe, tonightPrompt, type Recipe,
} from './recipe.ts';

const API = `/api/${manifest.id}`;
const LIST_KEY = 'recipes.list';
const PENDING_KEY = 'recipes.pending';         // when the last Claude request was sent (ISO time)
const PENDING_KIND_KEY = 'recipes.pendingKind'; // which request: create, adapt or tonight
const TIMERS_KEY = 'recipes.timers';
const PANTRY_KEY = 'recipes.pantry';         // the “What do you have” chips: { name, kind }
const TIMER_MINUTES = [5, 10, 15, 30];
const TONIGHT_TIMES = ['20 minutes', '40 minutes', '1 hour', ''];   // '' is no limit
const ICON = appIcon('recipes');
const NATIVE_OFF = 'Turn on “Run Claude chats on this tablet” under Settings, Apps, Claude, then try again.';

const HEART = (on: boolean) => `<svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/></svg>`;
const LENS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>';

type PendingKind = 'create' | 'adapt' | 'tonight' | 'pantry';
interface CookTimer { id: string; name: string; end: number }
type Draft = { kind: 'recipe'; recipe: Recipe } | { kind: 'text'; text: string };
type Screen = { t: 'discover' } | { t: 'detail'; r: Recipe } | { t: 'cook'; r: Recipe; step: number };
type Src = 'saved' | 'res' | 'pan';
interface Chip { name: string; kind: 'have' | 'want' }

let ctx: AppContext | undefined;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx!.$<T>(id);
const readJson = <T>(k: string, fallback: T): T => {
  try { return (JSON.parse(store.get(k) || 'null') as T | null) ?? fallback; } catch { return fallback; }
};

let recipes: Recipe[] = readJson<unknown[]>(LIST_KEY, []).map(fromStored).filter((r): r is Recipe => r !== null);
let screen: Screen = { t: 'discover' };
let pending: string | null = store.get(PENDING_KEY);
let pendingKind: PendingKind = (store.get(PENDING_KIND_KEY) as PendingKind | null) ?? 'create';
let draft: Draft | null = null;          // a reply waiting for Save or Discard
let msg = '';
let askTime = false;                     // Suggest for tonight: the time choice is open
let confirmDelete = false;
let timers: CookTimer[] = readJson<CookTimer[]>(TIMERS_KEY, []);
let tick: number | undefined;

// the Discover results: TheMealDB random meals, or the matches for the search
let query = '';
let results: Recipe[] = [];
let resultsState: 'idle' | 'loading' | 'ok' | 'error' = 'idle';
let resultsError = '';
let seq = 0;                             // the latest search wins

// What do you have: the chips (kept), the Want to buy switch, the field's text, the ingredient names from the hub, and the results
let pantry: Chip[] = readJson<Chip[]>(PANTRY_KEY, [])
  .filter(c => !!c && typeof c.name === 'string' && (c.kind === 'have' || c.kind === 'want')).slice(0, PANTRY_MAX);
let wantMode = false;                   // on: a new chip is “want” (outlined); off: “have” (filled)
let pantryText = '';
let names: string[] = [];
let namesState: 'idle' | 'loading' | 'ok' | 'error' = 'idle';
let found: Recipe[] = [];               // the ranked recipes, and the names each one lacks (foundMissing, in step)
let foundMissing: string[][] = [];
let foundState: 'idle' | 'loading' | 'ok' | 'error' = 'idle';
let foundError = '';
let foundSeq = 0;                       // the latest find wins

const saveRecipes = (): void => store.set(LIST_KEY, JSON.stringify(recipes));
const saveTimers = (): void => store.set(TIMERS_KEY, JSON.stringify(timers));
const savePantry = (): void => store.set(PANTRY_KEY, JSON.stringify(pantry));
const meta = (r: Recipe): string => [r.serves && `Serves ${r.serves}`, r.time].filter(Boolean).join(' · ');

/** The saved copy of a recipe: the same object, or the saved recipe with the same TheMealDB id. */
const savedIndex = (r: Recipe): number => recipes.findIndex(x => x === r || (!!r.mealId && x.mealId === r.mealId));
const pick = (src: Src | undefined, i: number): Recipe | undefined =>
  (src === 'saved' ? recipes[i] : src === 'pan' ? found[i] : results[i]);

function setPending(at: string | null, kind: PendingKind = pendingKind): void {
  pending = at;
  pendingKind = kind;
  store.set(PENDING_KEY, at);
  store.set(PENDING_KIND_KEY, at ? kind : null);
}

/** Looks for Claude's reply to the last request. Runs on every store change and when the app opens. */
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
  toTop();
  render();
}

/** Whether a message can go to the tablet's Claude chat now; sets the message when it cannot. */
function claudeReady(): boolean {
  if (!nativeOn()) msg = NATIVE_OFF;
  else if (nativeBusy()) msg = 'Claude is still answering a chat. Try again when it finishes.';
  else return true;
  return false;
}

function askClaude(prompt: string, kind: PendingKind): void {
  msg = '';
  askTime = false;
  if (claudeReady()) {
    try {
      nativeSend(prompt);
      setPending(new Date().toISOString(), kind);
      openApp('claude');
    } catch {
      msg = 'Claude could not start on this tablet.';
    }
  }
  toTop();
  render();
}

function adaptWithClaude(r: Recipe): void {
  msg = '';
  if (!claudeReady()) { toTop(); render(); return; }
  Keyboard.open({
    placeholder: 'How should Claude change it? For four people, gluten-free…', done: 'Ask Claude', max: 200,
    onDone: text => { if (text.trim()) askClaude(adaptPrompt(r, text), 'adapt'); },
  });
}

function openSearch(): void {
  Keyboard.open({
    value: query, placeholder: 'What are we cooking?', done: 'Search', max: 60,
    onDone: text => { screen = { t: 'discover' }; void search(text); },
  });
}

async function search(q: string): Promise<void> {
  query = q.trim().slice(0, 60);
  const mine = ++seq;
  resultsState = 'loading';
  render();
  try {
    const r = await getJson<MealsResult>(`${API}/search?q=${encodeURIComponent(query)}`);
    if (mine !== seq) return;
    results = (Array.isArray(r.recipes) ? r.recipes : []).map(fromStored).filter((x): x is Recipe => x !== null);
    resultsState = r.status === 'ok' ? 'ok' : 'error';
    resultsError = r.status === 'ok' ? '' : r.error;
  } catch {
    if (mine !== seq) return;
    results = [];
    resultsState = 'error';
    resultsError = 'No connection to TheMealDB.';
  }
  render();
}

function keep(r: Recipe): void {
  recipes = [r, ...recipes];
  saveRecipes();
  draft = null;
  confirmDelete = false;
  screen = { t: 'detail', r };
}

function toggleSave(r: Recipe): void {
  const i = savedIndex(r);
  recipes = i >= 0 ? recipes.filter((_, k) => k !== i) : [r, ...recipes];
  saveRecipes();
}

function toTop(): void {
  const el = ctx?.root.querySelector('#rcBody');
  if (el) el.scrollTop = 0;
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

// ---------- the notices: a message, the time choice, waiting for Claude, Claude's draft ----------
const WAITING: Record<PendingKind, string> = {
  create: 'Waiting for Claude’s recipe…',
  adapt: 'Waiting for Claude’s changed recipe…',
  tonight: 'Waiting for Claude’s idea for tonight…',
  pantry: 'Waiting for Claude’s recipe from your ingredients…',
};

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

function noticesHtml(): string {
  let out = msg ? `<p class="rc-msg">${esc(msg)}</p>` : '';
  if (askTime) {
    const chips = TONIGHT_TIMES.map(t => `<button class="rc-btn" data-act="tonight" data-time="${esc(t)}">${t ? esc(t) : 'No limit'}</button>`).join('');
    out += `<section class="rc-card"><b>How much time do you have tonight?</b>`
      + `<p class="rc-sub">Claude picks one dinner from your saved recipes, or one close to them.</p>`
      + `<div class="rc-actions">${chips}<button class="rc-btn quiet" data-act="cancel-time">Cancel</button></div></section>`;
  }
  if (pending) {
    out += `<section class="rc-card"><b>${esc(WAITING[pendingKind] ?? WAITING.create)}</b><p class="rc-sub">The reply shows here when it arrives.</p>`
      + `<div class="rc-actions"><button class="rc-btn" data-act="cancel-wait">Cancel</button></div></section>`;
  }
  if (draft) out += draftHtml(draft);
  return out;
}

// ---------- What do you have ----------
const nameKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Adds a chip unless the name is empty, already there, or the picker is full. The kind follows the Want to buy switch. */
function addChip(text: string): void {
  const name = text.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name || pantry.length >= PANTRY_MAX || pantry.some(c => nameKey(c.name) === nameKey(name))) return;
  pantry = [...pantry, { name, kind: wantMode ? 'want' : 'have' }];
  savePantry();
  resetFound();
}

/** The chips changed, so the last results no longer match them. A find still running is ignored. */
function resetFound(): void {
  foundSeq++;
  foundState = 'idle';
  found = [];
  foundMissing = [];
}

async function loadNames(): Promise<void> {
  if (namesState === 'loading' || namesState === 'ok') return;
  namesState = 'loading';
  try {
    const r = await getJson<IngredientsResult>(`${API}/ingredients`);
    names = r.status === 'ok' ? r.names : [];
    namesState = r.status === 'ok' ? 'ok' : 'error';
  } catch {
    names = [];
    namesState = 'error';
  }
  paintPicker();
}

/** Up to six ingredient names that start with the typed text, then the ones that contain it. Chips already added are left out. */
function suggestions(): string[] {
  const t = nameKey(pantryText);
  if (!t) return [];
  const taken = new Set(pantry.map(c => nameKey(c.name)));
  const starts: string[] = [], inside: string[] = [];
  for (const n of names) {
    const k = nameKey(n);
    if (taken.has(k)) continue;
    if (k.startsWith(t)) starts.push(n);
    else if (k.includes(t)) inside.push(n);
  }
  return [...starts, ...inside].slice(0, 6);
}

function openPantryKeyboard(): void {
  Keyboard.open({
    value: pantryText, placeholder: 'An ingredient, like “eggs”', done: 'Add', max: 40,
    onChange: t => { pantryText = t; paintPicker(); },
    onDone: t => { pantryText = ''; addChip(t); paintPicker(); },
    onClose: () => { pantryText = ''; paintPicker(); },
  });
}

/** Asks the hub for the recipes that use the "have" names. Nothing to ask with: nothing runs. */
async function findPantry(): Promise<void> {
  const have = pantry.filter(c => c.kind === 'have').map(c => c.name);
  if (!have.length) { resetFound(); paintPicker(); return; }
  const want = pantry.filter(c => c.kind === 'want').map(c => c.name);
  const mine = ++foundSeq;
  foundState = 'loading';
  paintPicker();
  const fail = (): void => { found = []; foundMissing = []; foundState = 'error'; foundError = 'Recipes are not available. Try again.'; };
  try {
    const r = await getJson<PantryResult>(`${API}/pantry?have=${encodeURIComponent(have.join(','))}&want=${encodeURIComponent(want.join(','))}`);
    if (mine !== foundSeq) return;
    if (r.status !== 'ok') { fail(); }
    else {
      const rows = (Array.isArray(r.recipes) ? r.recipes : [])
        .map(x => ({ recipe: fromStored(x), missing: Array.isArray(x.missing) ? x.missing : [] }))
        .filter((p): p is { recipe: Recipe; missing: string[] } => p.recipe !== null);
      found = rows.map(p => p.recipe);
      foundMissing = rows.map(p => p.missing);
      foundState = 'ok';
    }
  } catch {
    if (mine !== foundSeq) return;
    fail();
  }
  paintPicker();
}

const missingNote = (list: string[]): string => {
  if (!list.length) return 'Nothing missing';
  const shown = list.slice(0, 3).join(', ');
  return `Missing: ${shown}${list.length > 3 ? ` +${list.length - 3}` : ''}`;
};

function pantryHtml(): string {
  const full = pantry.length >= PANTRY_MAX;
  const field = `<button class="rc-pfield" data-act="pantry-type"${full ? ' disabled' : ''}>`
    + `<span class="rc-pfield-text${pantryText && !full ? ' on' : ''}">${esc(full ? `${PANTRY_MAX} at most` : pantryText || 'Add an ingredient')}</span></button>`;
  const want = `<button class="rc-want${wantMode ? ' on' : ''}" data-act="want-toggle" aria-pressed="${wantMode}">Want to buy</button>`;
  const chips = pantry.length
    ? `<div class="rc-chips">${pantry.map((c, i) => `<span class="rc-chip ${c.kind}">${esc(c.name)}`
      + `<button class="rc-chip-x" data-act="chip-x" data-i="${i}" aria-label="Remove ${esc(c.name)}">×</button></span>`).join('')}</div>`
    : '';
  const sug = suggestions();
  const sugHtml = sug.length
    ? `<div class="rc-sugs">${sug.map(n => `<button class="rc-sug" data-act="pantry-add" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>`
    : '';
  let body = '';
  if (!pantry.some(c => c.kind === 'have')) body = '<p class="rc-empty">Add what you have.</p>';
  else if (foundState === 'loading') {
    body = `<ul class="rc-grid">${Array.from({ length: 3 }, () => '<li class="rc-c rc-skel" aria-hidden="true"><span class="rc-ph"></span>'
      + '<span class="rc-cname">&nbsp;</span><span class="rc-ctag">&nbsp;</span></li>').join('')}</ul>`;
  } else if (foundState === 'error') body = `<p class="rc-empty">${esc(foundError)}</p>`;
  else if (foundState === 'ok' && !found.length) body = '<p class="rc-empty">No recipes use all of these. Ask Claude.</p>';
  else if (foundState === 'ok') body = `<ul class="rc-grid">${found.map((r, i) => cardHtml(r, 'pan', i, missingNote(foundMissing[i] ?? []))).join('')}</ul>`;
  return `<div class="rc-pantry">`
    + `<div class="rc-pantry-row">${field}${want}</div>${chips}${sugHtml}`
    + `<div class="rc-actions"><button class="rc-btn pri" data-act="pantry-find"${pantry.length ? '' : ' disabled'}>Find recipes</button>`
    + `<button class="rc-btn" data-act="pantry-ask">Ask Claude</button></div>`
    + body + `</div>`;
}

/** Repaints only the picker, so the keyboard and the scroll position stay. */
function paintPicker(): void {
  const el = ctx?.root.querySelector('[data-pantry]');
  if (el) el.innerHTML = pantryHtml();
}

// ---------- Discover ----------
function photoHtml(r: Recipe, cls: string): string {
  const img = r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" decoding="async">` : '';
  return `<span class="${cls}"><span class="rc-initial" aria-hidden="true">${esc(r.name.charAt(0).toUpperCase())}</span>${img}</span>`;
}

function cardHtml(r: Recipe, src: Src, i: number, note?: string): string {
  const on = savedIndex(r) >= 0;
  const sub = note || r.tag || meta(r) || (r.mealId ? 'TheMealDB' : 'Your recipe');
  // the heart only on TheMealDB recipes: Claude's recipes are deleted on their recipe page, with a second tap to confirm
  const heart = r.mealId
    ? `<button class="rc-heart${on ? ' on' : ''}" data-act="heart" data-src="${src}" data-i="${i}" aria-pressed="${on}" `
      + `aria-label="${on ? 'Remove from saved' : 'Save recipe'}">${HEART(on)}</button>`
    : '';
  return `<li class="rc-c"><button class="rc-cbtn" data-act="open" data-src="${src}" data-i="${i}">${photoHtml(r, 'rc-ph')}`
    + `<span class="rc-cname">${esc(r.name)}</span><span class="rc-ctag">${esc(sub)}</span></button>${heart}</li>`;
}

function todayHtml(): string {
  const i = recipeOfDay(recipes.length, new Date());
  if (i < 0) return '';
  const r = recipes[i];
  return `<button class="rc-today" data-act="open" data-src="saved" data-i="${i}">${photoHtml(r, 'rc-today-ph')}`
    + `<span class="rc-today-text"><span class="rc-kicker">Today, from your recipes</span>`
    + `<span class="rc-today-name">${esc(r.name)}</span><span class="rc-sub">${esc(r.tag || meta(r) || `${r.steps.length} steps`)}</span></span></button>`;
}

function discoverHtml(): string {
  const search = `<div class="rc-disc">`
    + `<button class="rc-search" data-act="search">${LENS}<span class="rc-search-text${query ? ' on' : ''}">${esc(query || 'What are we cooking?')}</span></button>`
    + (query ? `<button class="rc-btn quiet" data-act="clear">Clear</button>` : '')
    + `</div>`
    + `<div class="rc-claude"><span class="rc-kicker">With Claude</span>`
    + `<button class="rc-btn" data-act="ask-time">Suggest for tonight</button><button class="rc-btn" data-act="create">Create with Claude</button></div>`;
  const saved = recipes.length
    ? `<ul class="rc-row-cards">${recipes.map((r, i) => cardHtml(r, 'saved', i)).join('')}</ul>`
    : '<p class="rc-empty">Tap the heart on a recipe to keep it here.</p>';
  let empty = '';
  if (resultsState === 'loading' || resultsState === 'idle') empty = 'Looking for recipes…';
  else if (resultsState === 'error') empty = resultsError || 'TheMealDB did not answer. Try again.';
  else if (!results.length) empty = query ? `No recipes match “${query}”. Try one word, like “chicken” or “soup”.` : 'No recipes came back.';
  const grid = resultsState === 'ok' && results.length
    ? `<ul class="rc-grid">${results.map((r, i) => cardHtml(r, 'res', i)).join('')}</ul>` : '';
  return search + noticesHtml() + todayHtml()
    + `<h3 class="rc-h">Saved</h3>${saved}`
    + `<h3 class="rc-h">What do you have</h3><div data-pantry>${pantryHtml()}</div>`
    + `<h3 class="rc-h">${query ? `Results for “${esc(query)}”` : 'Ideas for today'}</h3>${grid}`
    + (empty ? `<p class="rc-empty">${esc(empty)}</p>` : '')
    + `<p class="rc-source">Recipes from TheMealDB</p>`;
}

// ---------- the recipe page ----------
function detailHtml(r: Recipe): string {
  const saved = savedIndex(r) >= 0;
  const ings = r.ingredients.map(g => `<li><span class="rc-amt">${esc(g.amount)}</span> ${esc(g.item)}</li>`).join('');
  const steps = r.steps.map(s => `<li>${esc(s)}</li>`).join('');
  const own = saved && !r.mealId;   // a recipe from Claude or saved as text can be deleted; a TheMealDB one is un-saved
  return `<div class="rc-top"><button class="rc-btn" data-act="discover">Back</button></div>`
    + noticesHtml()
    + `<div class="rc-hero">${photoHtml(r, 'rc-hero-ph')}<div class="rc-hero-text">`
    + (r.tag ? `<span class="rc-kicker">${esc(r.tag)}</span>` : '')
    + `<h2 class="rc-display">${esc(r.name)}</h2><p class="rc-sub">${esc(meta(r)) || 'Serves and time not given'}</p>`
    + `<div class="rc-actions"><button class="rc-btn pri" data-act="cook">Start cooking</button>`
    + (own
      ? `<button class="rc-btn danger" data-act="delete">${confirmDelete ? 'Tap again to delete' : 'Delete'}</button>`
      : `<button class="rc-btn rc-save${saved ? ' on' : ''}" data-act="save-this" aria-pressed="${saved}">${HEART(saved)}${saved ? 'Saved' : 'Save'}</button>`)
    + `</div></div></div>`
    + `<div class="rc-claude"><span class="rc-kicker">With Claude</span>`
    + `<button class="rc-btn" data-act="adapt">Adapt with Claude</button>`
    + `<button class="rc-btn" data-act="ask-time">Suggest for tonight</button>`
    + `<button class="rc-btn" data-act="create">Create with Claude</button></div>`
    + `<div class="rc-cols"><section><h3 class="rc-h">Ingredients</h3><ul class="rc-ings">${ings || '<li class="rc-sub">None listed.</li>'}</ul></section>`
    + `<section><h3 class="rc-h">Steps</h3><ol class="rc-steps">${steps}</ol></section></div>`
    + (r.mealId ? '<p class="rc-source">Recipe from TheMealDB</p>' : '');
}

// ---------- cook mode ----------
function cookHtml(r: Recipe, step: number): string {
  const s = cookStep(r, step);
  const presets = TIMER_MINUTES.map(m => `<button class="rc-btn" data-act="timer" data-min="${m}">${lengthWords(m * 60e3)}</button>`).join('');
  return `<div class="rc-top"><button class="rc-btn" data-act="detail">Exit cook mode</button>`
    + `<span class="rc-sub">${esc(r.name)}</span></div>`
    + `<p class="rc-kicker">${esc(s.heading)}</p><p class="rc-cook">${esc(s.text)}</p>`
    + `<div class="rc-actions"><button class="rc-btn big" data-act="step" data-d="-1" ${s.first ? 'disabled' : ''}>Previous</button>`
    + `<button class="rc-btn big pri" data-act="step" data-d="1" ${s.last ? 'disabled' : ''}>Next</button></div>`
    + `<div class="rc-timers-add"><span class="rc-sub">Timer for this step</span><div class="rc-actions">${presets}</div></div>`
    + `<div data-timers>${timersHtml()}</div>`;
}

function render(): void {
  if (!ctx) return;
  const el = $('rcBody');
  el.classList.toggle('cook', screen.t === 'cook');
  if (screen.t === 'detail') el.innerHTML = detailHtml(screen.r);
  else if (screen.t === 'cook') el.innerHTML = (draft ? draftHtml(draft) : '') + cookHtml(screen.r, screen.step);
  else el.innerHTML = discoverHtml();
}

function go(next: Screen): void {
  screen = next;
  confirmDelete = false;
  toTop();
}

function onClick(ev: Event): void {
  const b = (ev.target as Element).closest<HTMLElement>('[data-act]');
  if (!b) return;
  const i = Number(b.dataset.i);
  const src = b.dataset.src as Src | undefined;
  const act = b.dataset.act;
  msg = '';
  switch (act) {
    case 'search': openSearch(); return;
    case 'clear': void search(''); return;
    case 'create': askClaude(RECIPE_PROMPT, 'create'); return;
    case 'adapt': if (screen.t === 'detail') adaptWithClaude(screen.r); return;
    case 'ask-time': askTime = true; toTop(); break;
    case 'cancel-time': askTime = false; break;
    case 'tonight': askClaude(tonightPrompt(recipes.map(r => r.name), b.dataset.time ?? ''), 'tonight'); return;
    case 'save-draft':
      if (draft) { keep(draft.kind === 'recipe' ? draft.recipe : textRecipe(draft.text)); toTop(); }
      break;
    case 'discard-draft': draft = null; break;
    case 'pantry-type': openPantryKeyboard(); return;
    case 'pantry-add':
      addChip(b.dataset.name ?? '');
      pantryText = '';
      if (Keyboard.isOpen) Keyboard.close('chosen');
      break;
    case 'chip-x':
      pantry = pantry.filter((_, k) => k !== i);
      savePantry();
      resetFound();
      break;
    case 'want-toggle': wantMode = !wantMode; break;
    case 'pantry-find': void findPantry(); return;
    case 'pantry-ask': {
      const have = pantry.filter(c => c.kind === 'have').map(c => c.name);
      if (!have.length) { msg = 'Add what you have.'; break; }
      askClaude(pantryPrompt(have, pantry.filter(c => c.kind === 'want').map(c => c.name)), 'pantry');
      return;
    }
    case 'cancel-wait': setPending(null); break;
    case 'discover': go({ t: 'discover' }); break;
    case 'open': { const r = pick(src, i); if (r) go({ t: 'detail', r }); break; }
    case 'heart': { const r = pick(src, i); if (r) toggleSave(r); break; }
    case 'save-this': if (screen.t === 'detail') toggleSave(screen.r); break;
    case 'detail': if (screen.t === 'cook') go({ t: 'detail', r: screen.r }); break;
    case 'cook': if (screen.t === 'detail') go({ t: 'cook', r: screen.r, step: 0 }); break;
    case 'step':
      if (screen.t === 'cook') screen = { ...screen, step: cookStep(screen.r, screen.step + Number(b.dataset.d)).index };
      break;
    case 'timer':
      if (screen.t === 'cook') addTimer(`Step ${screen.step + 1}`, Number(b.dataset.min) * 60e3);
      break;
    case 'stop-timer':
      timers = timers.filter(t => t.id !== b.dataset.id);
      saveTimers();
      break;
    case 'delete': {
      if (screen.t !== 'detail') break;
      if (!confirmDelete) { confirmDelete = true; break; }
      const gone = savedIndex(screen.r);
      if (gone >= 0) { recipes = recipes.filter((_, k) => k !== gone); saveRecipes(); }
      go({ t: 'discover' });
      break;
    }
  }
  render();
}

const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount(c) {
    ctx = c;
    $('rcBody').addEventListener('click', onClick);
    ensureTick();
    render();
    void loadNames();
  },
  onShow() {
    checkReply();
    if (namesState === 'error') void loadNames();
    // the first visit, or a search that failed, asks TheMealDB again
    if (resultsState === 'idle' || resultsState === 'error') void search(query);
    else render();
  },
};

// Claude's reply is in the tablet chat's store entry; any store write may mean it has arrived.
onStore(() => checkReply());

export default app;

// The Lists app: the family's shared lists (Shopping, To-do, Notes, and any the family makes). On the tablet they live in
// local storage and work with the PC off (web/local.ts); the PC's copy (.lists.json, server/store.ts) is a sync target
// that Claude's tools also change. The Nest Hub has no copy of its own and talks to the PC as before.
//
// A row of tabs picks the list. Tap an item to tick it off (tap again to put it back); the pencil (or a tap on a note)
// opens the keyboard with its text to change it (Save or Cancel); the x or a swipe to the left removes it, with Undo
// for a few seconds. The bar at the bottom opens ClaudeOS's keyboard to add items (it stays up
// to add several). Clear ticked (header) takes the ticked items off. Notes are free text, one note per entry, not
// ticked. New list makes another tick-off list; one the family made can be deleted (Shopping, To-do and Notes stay).
//
// The lists reload when the app comes on screen and every 20 s while it is there (someone else, or Claude, may have
// changed them). On the tablet a change applies to its copy at once and waits in a queue; the queue goes to the PC in
// order whenever the PC answers, and then the PC's lists (with Claude's edits) replace the copy. On the first run the
// copy is taken from the PC once (GET lists); if the PC has lost its file, the copy is sent back (POST restore).
import { esc, getJson, postJson, store } from '../../../core/web/dom.ts';
import { caps } from '../../../core/web/device.ts';
import { hubReachable, onHubReachable } from '../../../core/web/hub-link.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { onBack } from '../../../core/web/system.ts';
import { MAX_ITEMS, MAX_LIST_NAME, MAX_LISTS, MAX_TEXT, cleanText, isBuiltIn, tickedPlaces, type FamilyList, type ListItem, type ListsResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { COPY_KEY, applyOp, type Op, type OpPath } from './local.ts';
import { appendOp, readQueue, remapQueue, removeOp } from './queue.ts';

const API = `/api/${manifest.id}`;
const REFRESH_MS = 20e3;
const UNDO_MS = 6000;
const SWIPE_START_PX = 10;       // a row starts to slide once the finger has moved this far sideways
const SWIPE_REMOVE_PX = 120;     // let go past this and it is removed

const ICON = appIcon('lists');
const TICK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7"/></svg>';
const PEN = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5l3 3L7 16H4v-3z"/><path d="M11 6l3 3"/></svg>';
const X = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';

let ctx: AppContext;
const $ = <T extends Element = HTMLElement>(id: string): T => ctx.$<T>(id);

let lists: FamilyList[] = [];
let loaded = false;
let current = 'shopping';
let note = '';
let gen = 0;                     // bumped by every change, so a reload that started before it doesn't undo it on screen
let timer: number | undefined;
let sheetOpen = false;
const busy = new Set<string>();

/** What Undo puts back: the items removed, each at its old place with its id, tick and time (restore-item). */
let undo: { list: string; label: string; restore: { item: ListItem; index: number }[] } | null = null;
let undoT: number | undefined;

const listNow = (): FamilyList | undefined => lists.find(l => l.id === current) ?? lists[0];

// ---------- the tablet's copy ----------
const readKey = <T>(k: string): T | null => { try { return JSON.parse(store.get(k) || 'null') as T | null; } catch { return null; } };
const copy = caps.localState ? readKey<FamilyList[]>(COPY_KEY) : null;
if (Array.isArray(copy)) { lists = copy; loaded = true; }
/** Changes apply on the tablet first once it has its copy (taken from the PC on the first run). */
const local = (): boolean => caps.localState && store.get(COPY_KEY) != null;
// Only the copy is written here. The queue is written by queue.ts alone (read first, then one change), so a change
// queued by a voice write while this page is open is kept.
function keep(): void {
  store.set(COPY_KEY, JSON.stringify(lists));
}

// ---------- talking to the PC ----------
function take(r: ListsResult | null | undefined): void {
  // the tablet's copy only takes a good answer: a refused change was never applied to it
  if (r && Array.isArray(r.lists) && (r.ok || !local())) {
    lists = r.lists;
    loaded = true;
    if (caps.localState && r.ok) keep();
  }
  if (!lists.some(l => l.id === current) && lists.length) current = lists[0].id;
}

/** Send the queued changes to the PC in order, then take its lists. Stops (the queue waits) while the PC is away. */
let flushing = false;
async function flush(): Promise<void> {
  if (flushing || !readQueue().length) return;
  flushing = true;
  try {
    // read the stored queue for each entry: a change queued meanwhile (voice) is sent too, and only the sent entry is removed
    for (let op = readQueue()[0]; op; op = readQueue()[0]) {
      let r: ListsResult;
      try { r = await postJson<ListsResult>(`${API}/${op.path}`, op.body); } catch { return; }
      if (!r || (!r.ok && r.retry)) return;   // the PC couldn't read or save its file: try again later
      removeOp(op.key!);              // done, or refused (Claude removed the item meanwhile): the PC's lists will show it
      if (op.path === 'add' && r.item && r.item.id !== op.body.id) remapQueue('id', op.body.id, r.item.id);
      if (op.path === 'new-list' && r.list && r.list !== op.body.id) remapQueue('list', op.body.id, r.list);
    }
  } finally { flushing = false; }
  void refresh();
}

// What the family often buys and is not on Shopping now (history.ts): tap to add it.
let suggest: string[] = [];
async function loadSuggest(): Promise<void> {
  if (current !== 'shopping') { suggest = []; paintSuggest(); return; }
  try { suggest = (await getJson<{ items: string[] }>(`${API}/suggest?list=shopping`)).items ?? []; } catch { suggest = []; }
  paintSuggest();
}
function paintSuggest(): void {
  const box = $('lsSuggest');
  box.hidden = !suggest.length;
  box.innerHTML = suggest.map(t => `<button class="ls-hbtn" data-sug="${esc(t)}">+ ${esc(t)}</button>`).join('');
}

// keepNote: a message the caller just set (the PC could not take a change) stays on screen through the reload
async function refresh(keepNote = false): Promise<void> {
  if (local() && readQueue().length) { await flush(); render(); return; }   // flush takes the PC's lists once the queue is sent
  const g = gen;
  try {
    const r = await getJson<ListsResult>(`${API}/lists`);
    if (g !== gen || swipe || readQueue().length) return;
    if (local() && r.ok && r.stored === false) take(await postJson<ListsResult>(`${API}/restore`, { lists }));
    else take(r);
    if (!keepNote) note = r.ok ? '' : r.error ?? '';
  } catch { if (g === gen && !keepNote) note = loaded ? '' : 'Couldn’t reach the PC. Trying again…'; }
  render();
  void loadSuggest();
}

async function send(path: OpPath, body: Record<string, unknown>): Promise<ListsResult | null> {
  gen++;
  if (local()) {
    const op: Op = { path, body: { ...body } };
    const r = applyOp(lists, op);
    note = r.ok ? '' : r.error ?? 'That didn’t work.';
    if (r.ok) { lists = r.lists; keep(); appendOp(op); void flush(); }
    render();
    return r;
  }
  try {
    const r = await postJson<ListsResult>(`${API}/${path}`, body);
    take(r);
    note = r.ok ? '' : r.error ?? 'That didn’t work.';
    render();
    return r;
  } catch {
    note = 'Couldn’t reach the PC. Try again in a moment.';
    void refresh(true);
    return null;
  }
}

// ---------- drawing ----------
const openCount = (l: FamilyList): number => (l.kind === 'notes' ? l.items.length : l.items.filter(i => !i.done).length);

function rowHtml(l: FamilyList, i: ListItem): string {
  const notes = l.kind === 'notes';
  const cls = `ls-row${i.done ? ' done' : ''}${notes ? ' note' : ''}${busy.has(i.id) ? ' busy' : ''}`;
  const main = notes
    ? `<button class="ls-tick" data-act="edit" aria-label="Edit note: ${esc(i.text)}"><span class="ls-text">${esc(i.text)}</span></button>`
    : `<button class="ls-tick" data-act="tick" role="checkbox" aria-checked="${i.done}"><span class="ls-box">${TICK}</span><span class="ls-text">${esc(i.text)}</span></button>`;
  return `<li class="${cls}" data-id="${esc(i.id)}"><div class="ls-row-bg" aria-hidden="true">Remove</div>`
    + `<div class="ls-row-fg">${main}<button class="ls-ed hit" data-act="edit" aria-label="Edit ${esc(i.text)}">${PEN}</button>`
    + `<button class="ls-x hit" data-act="remove" aria-label="Remove ${esc(i.text)}">${X}</button></div></li>`;
}

function render(): void {
  if (!ctx) return;
  const l = listNow();
  $('lsTabs').innerHTML = lists.map(x => {
    const n = openCount(x);
    return `<button class="ls-tab${x.id === l?.id ? ' on' : ''}" role="tab" aria-selected="${x.id === l?.id}" data-list="${esc(x.id)}">`
      + `${esc(x.name)}${n ? `<span class="ls-tab-n">${n}</span>` : ''}</button>`;
  }).join('');
  const n = $('lsNote');
  n.hidden = !note;
  n.textContent = note;

  if (!l) {
    $('lsTitle').textContent = loaded ? '' : 'Loading…';
    $('lsCount').textContent = '';
    $('lsItems').innerHTML = '';
    $('lsEmpty').hidden = true;
    $('lsClear').hidden = true;
    $('lsDelete').hidden = true;
    return;
  }
  const notes = l.kind === 'notes';
  const open = l.items.filter(i => !i.done), done = l.items.filter(i => i.done);
  $('lsTitle').textContent = l.name;
  $('lsCount').textContent = notes ? (l.items.length ? `${l.items.length} ${l.items.length === 1 ? 'note' : 'notes'}` : '')
    : l.items.length ? (open.length ? `${open.length} left` : 'All done') : '';
  $('lsDelete').hidden = isBuiltIn(l.id);
  $('lsClear').hidden = notes || !done.length;
  $('lsClear').textContent = `Clear ticked (${done.length})`;
  $('lsAddText').textContent = notes ? 'Write a note' : l.items.length >= MAX_ITEMS ? `${l.name} is full` : `Add to ${l.name}`;

  $('lsItems').innerHTML = notes
    ? [...l.items].reverse().map(i => rowHtml(l, i)).join('')      // newest note first
    : open.map(i => rowHtml(l, i)).join('')
      + (done.length ? `<li class="ls-sub" aria-hidden="true">Ticked</li>${done.map(i => rowHtml(l, i)).join('')}` : '');
  $('lsEmpty').hidden = l.items.length > 0 || !loaded;
  $('lsEmptyTitle').textContent = notes ? 'No notes yet' : `Nothing on ${l.name}`;
  $('lsEmptyText').textContent = notes ? 'Write one below. Claude can add notes too.' : 'Add the first item below, or ask Claude to.';
}

// ---------- actions ----------
function choose(id: string): void {
  if (id === current) return;
  current = id;
  note = '';
  render();
  $('lsScroll').scrollTop = 0;
  void loadSuggest();   // suggestions are for Shopping only: the list just changed
}

function tick(id: string): void {
  const l = listNow();
  const it = l?.items.find(i => i.id === id);
  if (!l || !it || l.kind !== 'check' || busy.has(id)) return;
  it.done = !it.done;             // at once on screen; the PC's answer replaces it
  busy.add(id);
  render();
  // the PC did not take the tick (no local copy to keep it): put the item back as it was, with the message
  void send('tick', { list: l.id, id, done: it.done }).then(r => { if (!r || !r.ok) it.done = !it.done; }).finally(() => { busy.delete(id); render(); });
}

function showUndo(u: NonNullable<typeof undo>): void {
  undo = u;
  $('lsUndoText').textContent = u.label;
  $('lsUndo').hidden = false;
  clearTimeout(undoT);
  undoT = window.setTimeout(hideUndo, UNDO_MS);
}
function hideUndo(): void { undo = null; clearTimeout(undoT); if (ctx) $('lsUndo').hidden = true; }

async function runUndo(): Promise<void> {
  const u = undo;
  hideUndo();
  if (!u) return;
  const back = [...u.restore].sort((a, b) => a.index - b.index);
  for (const r of back) {
    const a = await send('restore-item', { list: u.list, item: r.item, index: r.index });
    if (!a?.ok) break;
  }
}

function remove(id: string): void {
  const l = listNow();
  const it = l?.items.find(i => i.id === id);
  if (!l || !it) return;
  const index = l.items.indexOf(it);
  l.items = l.items.filter(i => i.id !== id);
  render();
  showUndo({
    list: l.id, label: `Removed ${it.text}`,
    restore: [{ item: { ...it }, index }],
  });
  void send('remove', { list: l.id, id });
}

/** Change an item's text: ClaudeOS's keyboard opens with the text in it; Save keeps the change, Cancel drops it. */
function edit(id: string): void {
  const l = listNow();
  const it = l?.items.find(i => i.id === id);
  if (!l || !it || busy.has(id)) return;
  Keyboard.open({
    value: it.text, placeholder: l.kind === 'notes' ? 'Edit the note' : 'Edit the item', done: 'Save', max: MAX_TEXT,
    onDone: text => {
      const t = cleanText(text);
      if (!t || t === it.text) return;             // nothing typed, or no change: Save just closes
      it.text = t;                                 // at once on screen; the PC's answer replaces it
      busy.add(id);
      render();
      void send('edit', { list: l.id, id, text: t }).finally(() => { busy.delete(id); render(); });
    },
  });
}

function clearTicked(): void {
  const l = listNow();
  if (!l) return;
  const done = l.items.filter(i => i.done);
  if (!done.length) return;
  const back = tickedPlaces(l);
  l.items = l.items.filter(i => !i.done);
  render();
  showUndo({ list: l.id, label: `Cleared ${back.length} ticked`, restore: back });
  void send('clear-done', { list: l.id });
}

/** The keyboard stays up after each item, so a few can go in one after another. */
function openAdd(): void {
  const l = listNow();
  if (!l) return;
  const notes = l.kind === 'notes';
  if (!notes && l.items.length >= MAX_ITEMS) { note = `${l.name} is full (${MAX_ITEMS} items). Clear the ticked ones first.`; render(); return; }
  Keyboard.open({
    placeholder: notes ? 'Write a note' : `Add to ${l.name}`, done: 'Add', autoCap: !notes, max: MAX_TEXT,
    onDone: text => {
      const t = cleanText(text);
      if (!t) return;             // nothing typed: Add just closes
      void send('add', { list: l.id, text: t }).then(() => loadSuggest());   // an added item leaves the suggestions
      if (notes) return;          // a note is one entry: done
      openAdd();                  // a fresh, empty keyboard for the next item
      return false;
    },
  });
}

function newList(): void {
  if (lists.length >= MAX_LISTS) { note = `There are already ${MAX_LISTS} lists. Delete one first.`; render(); return; }
  Keyboard.open({
    placeholder: 'Name the new list', done: 'Make list', autoCap: true, max: MAX_LIST_NAME,
    onDone: text => {
      const name = cleanText(text);
      if (!name) return;
      void send('new-list', { name }).then(r => { if (r?.ok && r.list) choose(r.list); });
    },
  });
}

function askDelete(): void {
  const l = listNow();
  if (!l || isBuiltIn(l.id)) return;
  const n = l.items.length;
  $('lsSheetCard').innerHTML = `<h3>Delete ${esc(l.name)}?</h3>`
    + `<p>${n ? `Its ${n} ${n === 1 ? 'item goes' : 'items go'} with it. ` : ''}This can’t be undone.</p>`
    + `<div class="ls-sheet-btns"><button class="ls-btn" data-act="cancel">Cancel</button><button class="ls-btn danger" data-act="delete" data-list="${esc(l.id)}">Delete</button></div>`;
  $('lsSheet').hidden = false;
  sheetOpen = true;
}
function closeSheet(): void { sheetOpen = false; if (ctx) $('lsSheet').hidden = true; }

function onSheetClick(ev: Event): void {
  const t = ev.target as HTMLElement;
  if (t === $('lsSheet')) { closeSheet(); return; }
  const b = t.closest<HTMLElement>('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'delete' && b.dataset.list) {
    const id = b.dataset.list;
    closeSheet();
    hideUndo();
    void send('delete-list', { list: id });
  } else closeSheet();
}

// ---------- swipe to remove ----------
let swipe: { id: string; fg: HTMLElement; x: number; y: number; dx: number; on: boolean; pid: number } | null = null;
let swallowClick = false;

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const row = (e.target as Element).closest<HTMLElement>('.ls-row');
  const fg = row?.querySelector<HTMLElement>('.ls-row-fg');
  if (!row || !fg || !row.dataset.id) return;
  swipe = { id: row.dataset.id, fg, x: e.clientX, y: e.clientY, dx: 0, on: false, pid: e.pointerId };
}
function onMove(e: PointerEvent): void {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.on) {
    if (Math.abs(dy) > SWIPE_START_PX && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }   // a scroll
    if (dx > -SWIPE_START_PX) return;
    swipe.on = true;
    swipe.fg.classList.remove('snap');
  }
  swipe.dx = Math.min(0, dx);
  swipe.fg.style.transform = `translateX(${swipe.dx}px)`;
}
function onUp(e: PointerEvent): void {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const s = swipe;
  swipe = null;
  if (!s.on) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 0);
  if (s.dx <= -SWIPE_REMOVE_PX) { remove(s.id); return; }
  s.fg.classList.add('snap');
  s.fg.style.transform = '';
}
function onCancel(e: PointerEvent): void {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const s = swipe;
  swipe = null;
  s.fg.classList.add('snap');
  s.fg.style.transform = '';
}

function onItemsClick(ev: Event): void {
  if (swallowClick) return;
  const b = (ev.target as Element).closest<HTMLElement>('[data-act]');
  const id = b?.closest<HTMLElement>('.ls-row')?.dataset.id;
  if (!b || !id) return;
  if (b.dataset.act === 'tick') tick(id);
  else if (b.dataset.act === 'edit') edit(id);
  else if (b.dataset.act === 'remove') remove(id);
}

// ---------- the app ----------
function start(): void { stop(); timer = window.setInterval(() => { void refresh(); }, REFRESH_MS); }
function stop(): void { if (timer) clearInterval(timer); timer = undefined; }

const app: HubApp = {
  ...manifest,
  icon: ICON,
  mount(c) {
    ctx = c;
    $('lsTabs').addEventListener('click', ev => {
      const b = (ev.target as Element).closest<HTMLElement>('[data-list]');
      if (b?.dataset.list) choose(b.dataset.list);
    });
    const items = $('lsItems');
    items.addEventListener('click', onItemsClick);
    items.addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    $('lsAdd').addEventListener('click', openAdd);
    $('lsNew').addEventListener('click', newList);
    $('lsClear').addEventListener('click', clearTicked);
    $('lsDelete').addEventListener('click', askDelete);
    $('lsUndoBtn').addEventListener('click', () => { void runUndo(); });
    $('lsSuggest').addEventListener('click', ev => {
      const t = (ev.target as Element).closest<HTMLElement>('[data-sug]')?.dataset.sug;
      if (!t) return;
      suggest = suggest.filter(x => x !== t);
      paintSuggest();
      void send('add', { list: 'shopping', text: t }).then(() => loadSuggest());
    });
    $('lsSheet').addEventListener('click', onSheetClick);
    onHubReachable(() => { if (hubReachable()) void flush(); });   // the PC is back: send what waited
    onBack(() => {
      if (!ctx.isVisible() || Keyboard.isOpen || !sheetOpen) return false;
      closeSheet();
      return true;
    }, 10);
    render();
  },
  onShow() { void refresh(); start(); },
  onHide() {
    stop();
    closeSheet();
    hideUndo();
    if (Keyboard.isOpen) Keyboard.close('nav');
  },
};
export default app;

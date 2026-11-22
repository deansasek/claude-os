// The Lists app: the family's shared lists (Shopping, To-do, Notes, and any the family makes), kept on the PC
// (.lists.json, server/store.ts) so everyone at home and Claude see the same ones.
//
// A row of tabs picks the list. Tap an item to tick it off (tap again to put it back); the x or a swipe to the left
// removes it, with Undo for a few seconds. The bar at the bottom opens ClaudeOS's keyboard to add items (it stays up
// to add several). Clear ticked (header) takes the ticked items off. Notes are free text, one note per entry, not
// ticked. New list makes another tick-off list; one the family made can be deleted (Shopping, To-do and Notes stay).
//
// The lists reload when the app comes on screen and every 20 s while it is there (someone else, or Claude, may have
// changed them). Every change goes to the PC at once, which checks it again.
import { esc, getJson, postJson } from '../../../core/web/dom.ts';
import { Keyboard } from '../../../core/web/keyboard.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { onBack } from '../../../core/web/system.ts';
import { MAX_ITEMS, MAX_LIST_NAME, MAX_LISTS, MAX_TEXT, cleanText, isBuiltIn, type FamilyList, type ListItem, type ListsResult } from '../api.ts';
import { manifest } from '../manifest.ts';

const API = `/api/${manifest.id}`;
const REFRESH_MS = 20e3;
const UNDO_MS = 6000;
const SWIPE_START_PX = 10;       // a row starts to slide once the finger has moved this far sideways
const SWIPE_REMOVE_PX = 120;     // let go past this and it is removed

const ICON = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'
  + '<path d="M5 9l2 2 3.5-3.5"/><path d="M5 17l2 2 3.5-3.5"/><path d="M5 25l2 2 3.5-3.5"/><path d="M14.5 9.5H27M14.5 17.5H27M14.5 25.5H23"/></svg>';
const TICK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7"/></svg>';
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

let undo: { list: string; items: { text: string; done: boolean }[]; label: string } | null = null;
let undoT: number | undefined;

const listNow = (): FamilyList | undefined => lists.find(l => l.id === current) ?? lists[0];

// ---------- talking to the PC ----------
function take(r: ListsResult | null | undefined): void {
  if (r && Array.isArray(r.lists)) { lists = r.lists; loaded = true; }
  if (!lists.some(l => l.id === current) && lists.length) current = lists[0].id;
}

async function refresh(): Promise<void> {
  const g = gen;
  try {
    const r = await getJson<ListsResult>(`${API}/lists`);
    if (g !== gen || swipe) return;
    take(r);
    note = r.ok ? '' : r.error ?? '';
  } catch { if (g === gen) note = loaded ? '' : 'Couldn’t reach the PC. Trying again…'; }
  render();
}

async function send(path: string, body: Record<string, unknown>): Promise<ListsResult | null> {
  gen++;
  try {
    const r = await postJson<ListsResult>(`${API}/${path}`, body);
    take(r);
    note = r.ok ? '' : r.error ?? 'That didn’t work.';
    render();
    return r;
  } catch {
    note = 'Couldn’t reach the PC. Try again in a moment.';
    void refresh();
    return null;
  }
}

// ---------- drawing ----------
const openCount = (l: FamilyList): number => (l.kind === 'notes' ? l.items.length : l.items.filter(i => !i.done).length);

function rowHtml(l: FamilyList, i: ListItem): string {
  const notes = l.kind === 'notes';
  const cls = `ls-row${i.done ? ' done' : ''}${notes ? ' note' : ''}${busy.has(i.id) ? ' busy' : ''}`;
  const main = notes
    ? `<span class="ls-tick" data-act="none"><span class="ls-text">${esc(i.text)}</span></span>`
    : `<button class="ls-tick" data-act="tick" role="checkbox" aria-checked="${i.done}"><span class="ls-box">${TICK}</span><span class="ls-text">${esc(i.text)}</span></button>`;
  return `<li class="${cls}" data-id="${esc(i.id)}"><div class="ls-row-bg" aria-hidden="true">Remove</div>`
    + `<div class="ls-row-fg">${main}<button class="ls-x hit" data-act="remove" aria-label="Remove ${esc(i.text)}">${X}</button></div></li>`;
}

function render(): void {
  if (!ctx) return;
  const l = listNow();
  $('lsTabs').innerHTML = lists.map(x => {
    const n = openCount(x);
    return `<button class="ls-tab${x.id === l?.id ? ' on' : ''}" role="tab" aria-selected="${x.id === l?.id}" data-list="${esc(x.id)}">`
      + `${esc(x.name)}${n ? `<span class="ls-tab-n">${n}</span>` : ''}</button>`;
  }).join('');
  $('lsNew').hidden = lists.length >= MAX_LISTS;

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
}

function tick(id: string): void {
  const l = listNow();
  const it = l?.items.find(i => i.id === id);
  if (!l || !it || l.kind !== 'check' || busy.has(id)) return;
  it.done = !it.done;             // at once on screen; the PC's answer replaces it
  busy.add(id);
  render();
  void send('tick', { list: l.id, id, done: it.done }).finally(() => { busy.delete(id); render(); });
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
  for (const it of u.items) {
    const r = await send('add', { list: u.list, text: it.text });
    if (!r?.ok) break;
    if (it.done && r.item) await send('tick', { list: u.list, id: r.item.id, done: true });
  }
}

function remove(id: string): void {
  const l = listNow();
  const it = l?.items.find(i => i.id === id);
  if (!l || !it) return;
  l.items = l.items.filter(i => i.id !== id);
  render();
  showUndo({ list: l.id, items: [{ text: it.text, done: it.done }], label: `Removed ${it.text}` });
  void send('remove', { list: l.id, id });
}

function clearTicked(): void {
  const l = listNow();
  if (!l) return;
  const done = l.items.filter(i => i.done);
  if (!done.length) return;
  l.items = l.items.filter(i => !i.done);
  render();
  showUndo({ list: l.id, items: done.map(i => ({ text: i.text, done: true })), label: `Cleared ${done.length} ticked` });
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
      void send('add', { list: l.id, text: t });
      if (notes) return;          // a note is one entry: done
      openAdd();                  // a fresh, empty keyboard for the next item
      return false;
    },
  });
}

function newList(): void {
  if (lists.length >= MAX_LISTS) return;
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
    $('lsSheet').addEventListener('click', onSheetClick);
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

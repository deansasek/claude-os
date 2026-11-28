// The Meals app: this week's dinners, one row a night. Tap a night to type a dinner; Save writes it to the ClaudeOS
// calendar as an all-day event, so it shows on Calendar and Home too. Remove deletes it. The week is read from the PC's
// local calendar (GET /api/calendar/local) and changed with the calendar's own write routes.
import { esc, getJson, postJson, store } from '../../../core/web/dom.ts';
import { appIcon } from '../../../core/web/app-icons.ts';
import type { AppContext, HubApp } from '../../../core/web/shell.ts';
import { manifest } from '../manifest.ts';
import { dinnerOn, dinnerTitle, dinnersIn, isoDay, mondayOf, savedRecipeNames, weekDays, type Day, type Dinner } from './week.ts';

const API = '/api/calendar';
const RECIPES_KEY = 'recipes.list';   // the Recipes app's saved list, on the tablet's own store
const READ_TIMEOUT_MS = 10e3;
const WRITE_TIMEOUT_MS = 10e3;

let ctx: AppContext | null = null;
let monday = mondayOf(new Date());
let days: Day[] = weekDays(monday);
let dinners: Dinner[] = [];
let editing: number | null = null;
let busy = false;
let status = '';

interface LocalRead { status?: string; events?: { id: string; title: string; start: number; end: number; allDay: boolean }[]; error?: string }

function setStatus(c: AppContext, text: string): void {
  status = text;
  c.$('mpStatus').textContent = text;
}

function paint(c: AppContext): void {
  const first = days[0].date, last = days[6].date;
  const fmt = (d: Date): string => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  c.$('mpRange').textContent = `${fmt(first)} – ${fmt(last)}`;
  c.$('mpDays').innerHTML = days.map((d, i) => {
    const dinner = dinnerOn(dinners, d);
    const label = d.date.toLocaleDateString(undefined, { weekday: 'long' });
    if (editing === i) {
      const chips = savedRecipeNames(store.get(RECIPES_KEY))
        .map(n => `<button class="mp-chip" data-act="pick" data-i="${i}" data-name="${esc(n)}">${esc(n)}</button>`).join('');
      return `<div class="mp-day"><div class="mp-dow">${esc(label)}</div><div class="mp-edit-wrap">
        ${chips ? `<div class="mp-chips">${chips}</div>` : ''}
        <div class="mp-edit">
        <input class="mp-input" data-i="${i}" maxlength="60" placeholder="What’s for dinner?" value="${esc(dinner?.text ?? '')}">
        <button class="mp-btn primary" data-act="save" data-i="${i}">Save</button>
        ${dinner ? `<button class="mp-btn" data-act="remove" data-i="${i}">Remove</button>` : ''}
        <button class="mp-btn" data-act="cancel" data-i="${i}">Cancel</button></div></div></div>`;
    }
    return `<div class="mp-day"><div class="mp-dow">${esc(label)}</div>
      <button class="mp-text${dinner ? '' : ' empty'}" data-act="edit" data-i="${i}">${esc(dinner?.text || 'Add a dinner')}</button></div>`;
  }).join('');
}

/** Read the week's ClaudeOS events from the PC and show them. */
async function load(c: AppContext): Promise<void> {
  const from = isoDay(days[0].date), to = isoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7));
  try {
    const r = await getJson<LocalRead>(`${API}/local?from=${from}&to=${to}`, READ_TIMEOUT_MS);
    if (r.status !== 'ok') { setStatus(c, r.error || 'Couldn’t read the week from your PC.'); dinners = []; }
    else { dinners = dinnersIn(r.events ?? []); if (status) setStatus(c, ''); }
  } catch {
    setStatus(c, 'Couldn’t reach your PC. Try again in a moment.');
    dinners = [];
  }
  paint(c);
}

/** Save the dinner typed for a night: a new all-day event, or a change to the one already there. */
async function save(c: AppContext, i: number): Promise<void> {
  if (busy) return;
  const text = (c.$('mpDays').querySelector<HTMLInputElement>(`input[data-i="${i}"]`)?.value ?? '').trim();
  if (!text) { setStatus(c, 'Type a dinner, or Cancel.'); return; }
  const day = days[i], existing = dinnerOn(dinners, day);
  busy = true;
  setStatus(c, 'Saving…');
  try {
    const r = existing
      ? await postJson<{ error?: string }>(`${API}/local-update`, { id: existing.id, title: dinnerTitle(text) }, WRITE_TIMEOUT_MS)
      : await postJson<{ error?: string }>(`${API}/local-add`, { title: dinnerTitle(text), start: day.start, end: day.end, allDay: true }, WRITE_TIMEOUT_MS);
    if (r.error) { setStatus(c, r.error); return; }
    editing = null;
    setStatus(c, '');
    await load(c);
  } catch {
    setStatus(c, 'Couldn’t reach your PC. Try again in a moment.');
  } finally {
    busy = false;
  }
}

/** Remove the dinner for a night. */
async function remove(c: AppContext, i: number): Promise<void> {
  const existing = dinnerOn(dinners, days[i]);
  if (!existing || busy) return;
  busy = true;
  try {
    const r = await postJson<{ error?: string }>(`${API}/local-delete`, { id: existing.id }, WRITE_TIMEOUT_MS);
    if (r.error) { setStatus(c, r.error); return; }
    editing = null;
    await load(c);
  } catch {
    setStatus(c, 'Couldn’t reach your PC. Try again in a moment.');
  } finally {
    busy = false;
  }
}

function shiftWeek(c: AppContext, weeks: number): void {
  monday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7 * weeks);
  days = weekDays(monday);
  editing = null;
  void load(c);
}

const app: HubApp = {
  ...manifest,
  icon: appIcon('meals'),
  mount(c: AppContext) {
    ctx = c;
    c.$('mpPrev').addEventListener('click', () => shiftWeek(c, -1));
    c.$('mpNext').addEventListener('click', () => shiftWeek(c, 1));
    c.$('mpDays').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const i = Number(b.dataset.i);
      if (b.dataset.act === 'edit') { editing = i; paint(c); c.$('mpDays').querySelector<HTMLInputElement>(`input[data-i="${i}"]`)?.focus(); }
      if (b.dataset.act === 'cancel') { editing = null; paint(c); }
      if (b.dataset.act === 'pick') {   // a saved recipe fills the box; Save then writes it as the dinner
        const input = c.$('mpDays').querySelector<HTMLInputElement>(`input[data-i="${i}"]`);
        if (input) { input.value = b.dataset.name ?? ''; input.focus(); }
      }
      if (b.dataset.act === 'save') void save(c, i);
      if (b.dataset.act === 'remove') void remove(c, i);
    });
    paint(c);
    void load(c);
  },
  // shown again: read the week afresh, so a dinner added on another screen shows
  onShow() { if (ctx) void load(ctx); },
  onClose() { editing = null; },
};
export default app;

// This week's dinners on the Shopping list. Shared by Meals and Lists: the week's dinners are read from the ClaudeOS calendar,
// each dinner is matched to a saved recipe by name, and the ingredients not already on Shopping are written to it.
import { getJson, store } from '../../../core/web/dom.ts';
import { fromStored, shoppingItems } from '../../recipes/web/recipe.ts';
import { isQueued, readLists, writeList } from '../../lists/web/readers.ts';
import { addManyReply } from '../../lists/web/voice-match.ts';
import { dinnersIn, isoDay, mondayOf, weekDays, weekIngredients, type Dinner } from './week.ts';

const API = '/api/calendar';
const RECIPES_KEY = 'recipes.list';   // the Recipes app's saved list, on the tablet's own store
const READ_TIMEOUT_MS = 10e3;
const LIST_TIMEOUT_MS = 20e3;         // the Shopping list read gives up after this long, as Recipes' does
interface LocalRead { status?: string; events?: { id: string; title: string; start: number; end: number; allDay: boolean }[]; error?: string }

/** The dinners of the week that holds today. Throws when the PC cannot read the calendar. */
export async function weekDinners(today: Date = new Date()): Promise<Dinner[]> {
  const week = weekDays(mondayOf(today));
  const from = isoDay(week[0].date), to = isoDay(new Date(week[6].date.getFullYear(), week[6].date.getMonth(), week[6].date.getDate() + 1));
  const r = await getJson<LocalRead>(`${API}/local?from=${from}&to=${to}`, READ_TIMEOUT_MS);
  if (r.status !== 'ok') throw new Error(r.error || 'calendar');
  return dinnersIn(r.events ?? []);
}

/** Put the ingredients of these dinners on Shopping. Returns the line to show. Nothing is written when the list cannot be read. */
export async function addDinnersToShopping(dinners: Dinner[]): Promise<string> {
  const recipes = (() => { try { return JSON.parse(store.get(RECIPES_KEY) ?? '[]') as unknown[]; } catch { return []; } })()
    .filter((v): v is object => !!v && typeof v === 'object').map(fromStored).filter((r): r is NonNullable<typeof r> => r !== null);
  const { items, unmatched } = weekIngredients(dinners.map(d => d.text),
    recipes.map(r => ({ name: r.name, ingredients: r.ingredients.map(i => i.item) })));
  let onList: string[];
  try {
    const shopping = (await readLists(LIST_TIMEOUT_MS)).find(l => l.id === 'shopping');
    onList = (shopping?.items ?? []).filter(i => !i.done).map(i => i.text);
  } catch {
    return 'Couldn’t reach your PC, so nothing was added. Try again.';
  }
  const todo = shoppingItems(items, onList);
  const note = unmatched.length ? ` No saved recipe for ${unmatched.join(', ')}.` : '';
  if (!todo.length) return (items.length ? 'Everything for this week is already on Shopping.' : 'No saved recipes for this week’s dinners yet.') + note;
  let ok = 0, waiting = 0;
  for (const text of todo) {
    try { const r = await writeList('add', { list: 'shopping', text }); if (r?.ok) ok++; }
    catch (e) { if (isQueued(e)) waiting++; }
  }
  return (!ok && !waiting ? 'I couldn’t add those to Shopping.' : addManyReply(todo, ok, waiting, 'Shopping')) + note;
}

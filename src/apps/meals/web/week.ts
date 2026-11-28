// The week's dinners, with no DOM: the seven days from a Monday, and a dinner as an all-day ClaudeOS calendar event titled
// "Dinner: …". Days are local, so a night is the same night on the tablet and on the PC.
export const DINNER = 'Dinner: ';
const MAX_TEXT = 60;

export interface Day { iso: string; start: number; end: number; date: Date }
export interface Dinner { id: string; text: string; start: number }

/** The Monday of the week that holds d, at local midnight. */
export function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(m.getFullYear(), m.getMonth(), m.getDate() - ((m.getDay() + 6) % 7));
}

/** A date as YYYY-MM-DD in local time. */
export const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The seven days from a Monday: each with its local start, and the next midnight as its end. */
export function weekDays(monday: Date): Day[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const next = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i + 1);
    return { iso: isoDay(date), start: date.getTime(), end: next.getTime(), date };
  });
}

/** The calendar title for a dinner, with the text trimmed and kept to a short line. */
export const dinnerTitle = (text: string): string => `${DINNER}${text.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_TEXT)}`;

/** The dinners among the calendar events: the ones titled "Dinner: …". */
export function dinnersIn(events: { id: string; title: string; start: number; allDay?: boolean }[]): Dinner[] {
  return events.flatMap(e => (e.title.startsWith(DINNER)
    ? [{ id: e.id, text: e.title.slice(DINNER.length), start: e.start }] : []));
}

/** The names of the saved recipes (the Recipes app's list, as stored), for picking a dinner: unique, trimmed, the first 12. */
export function savedRecipeNames(raw: string | null): string[] {
  let list: unknown;
  try { list = JSON.parse(raw ?? '[]'); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const names = list.flatMap(v => {
    const n = v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
      ? (v as { name: string }).name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_TEXT) : '';
    return n ? [n] : [];
  });
  return [...new Set(names)].slice(0, 12);
}

/** The ingredients for a week's dinners: each dinner matched to a saved recipe by name (ignoring case). Nights with a dinner
 *  but no saved recipe are returned as unmatched, so the page can say so. Each ingredient is listed once. */
export function weekIngredients(dinnerTexts: string[], recipes: { name: string; ingredients: string[] }[]): { items: string[]; unmatched: string[] } {
  const byName = new Map(recipes.map(r => [r.name.trim().toLowerCase(), r.ingredients] as const));
  const items = new Set<string>();
  const unmatched: string[] = [];
  for (const raw of dinnerTexts) {
    const text = raw.trim();
    if (!text) continue;
    const ingredients = byName.get(text.toLowerCase());
    if (ingredients) ingredients.forEach(i => items.add(i));
    else unmatched.push(text);
  }
  return { items: [...items], unmatched };
}

/** The dinner for one day, if there is one. */
export const dinnerOn = (dinners: Dinner[], day: Day): Dinner | null => dinners.find(d => d.start === day.start) ?? null;

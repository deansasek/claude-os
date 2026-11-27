// Recipes app routes (under /api/recipes/). The page asks the hub, so the browser never calls TheMealDB itself.
// TheMealDB is free and needs no account (its public test key "1" is part of the address).
//   GET search?q=…   meals whose name matches q; an empty q gives the random meals
//   GET random       up to 8 random meals (kept for 30 minutes)
//   GET ingredients  the ingredient names TheMealDB knows (kept for 24 hours)
//   GET pantry?have=a,b&want=c   the meals that use the "have" names, ranked by what is missing (web/pantry.ts);
//                    each filter call is kept for an hour; more than 8 names is an error
import type { ServerApp } from '../../../core/server/app.ts';
import type { IngredientsResult, MealsResult, PantryResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { mapMeals } from '../web/mealdb.ts';
import { PANTRY_TOP, parsePantry, rankPantry } from '../web/pantry.ts';
import type { Recipe } from '../web/recipe.ts';

const API = 'https://www.themealdb.com/api/json/v1/1';
const RANDOM_COUNT = 8;
const RANDOM_KEEP_MS = 30 * 60e3;
const INGREDIENTS_KEEP_MS = 24 * 3600e3;
const FILTER_KEEP_MS = 3600e3;

let randomCache: { at: number; recipes: Recipe[] } | null = null;
let ingredientCache: { at: number; names: string[] } | null = null;
const filterCache = new Map<string, { at: number; meals: unknown[] }>();   // per "have" name: the meals filter.php gives

async function meals(path: string): Promise<unknown[]> {
  const r = await fetch(`${API}/${path}`, { headers: { 'User-Agent': 'ClaudeOS-Recipes', Accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body: any = await r.json();
  return Array.isArray(body?.meals) ? body.meals : [];
}

const NO_ANSWER = 'TheMealDB did not answer. Try again.';
/** Log the raw error on the hub; the page only ever sees NO_ANSWER. */
const errorText = (e: unknown): string => {
  console.log('recipes: TheMealDB request failed', e);
  return NO_ANSWER;
};
const failed = (e: unknown): MealsResult => ({ status: 'error', recipes: [], error: errorText(e) });

async function random(): Promise<MealsResult> {
  if (randomCache && Date.now() - randomCache.at < RANDOM_KEEP_MS) return { status: 'ok', recipes: randomCache.recipes };
  const lists = await Promise.allSettled(Array.from({ length: RANDOM_COUNT }, () => meals('random.php')));
  const found = lists.flatMap(p => (p.status === 'fulfilled' ? p.value : []));
  if (!found.length) {
    const why = lists.find((p): p is PromiseRejectedResult => p.status === 'rejected');
    return failed(why ? why.reason : 'No recipes came back.');
  }
  const recipes = mapMeals(found);
  randomCache = { at: Date.now(), recipes };
  return { status: 'ok', recipes };
}

async function search(q: string): Promise<MealsResult> {
  const name = q.trim().slice(0, 60);
  if (!name) return random();
  try {
    return { status: 'ok', recipes: mapMeals(await meals(`search.php?s=${encodeURIComponent(name)}`)) };
  } catch (e) {
    return failed(e);
  }
}

async function ingredients(): Promise<IngredientsResult> {
  if (ingredientCache && Date.now() - ingredientCache.at < INGREDIENTS_KEEP_MS) return { status: 'ok', names: ingredientCache.names };
  try {
    const names = [...new Set((await meals('list.php?i=list')).map(m => String((m as any)?.strIngredient ?? '').trim()).filter(Boolean))].sort();
    // an empty answer is a failure, not a list to keep for 24 hours (as random() does)
    if (!names.length) return { status: 'error', names: [], error: errorText('No ingredients came back.') };
    ingredientCache = { at: Date.now(), names };
    return { status: 'ok', names };
  } catch (e) {
    return { status: 'error', names: [], error: errorText(e) };
  }
}

/** The meals filter.php gives for one ingredient, kept for an hour. */
async function byIngredient(name: string): Promise<unknown[]> {
  const hit = filterCache.get(name);
  if (hit && Date.now() - hit.at < FILTER_KEEP_MS) return hit.meals;
  const found = await meals(`filter.php?i=${encodeURIComponent(name)}`);
  filterCache.set(name, { at: Date.now(), meals: found });
  return found;
}

async function pantry(haveText: string, wantText: string): Promise<PantryResult> {
  const p = parsePantry(haveText, wantText);
  if (!p.ok) return { status: 'error', recipes: [], error: p.error };
  if (!p.have.length) return { status: 'ok', recipes: [] };
  const lists = await Promise.allSettled(p.have.map(byIngredient));
  if (lists.every(l => l.status === 'rejected')) return { status: 'error', recipes: [], error: errorText((lists[0] as PromiseRejectedResult).reason) };
  // count the "have" names each meal matches, keep the best PANTRY_TOP, then fetch those meals in full
  const count = new Map<string, { meal: any; n: number }>();
  for (const l of lists) {
    if (l.status !== 'fulfilled') continue;
    for (const m of l.value) {
      const id = String((m as any)?.idMeal ?? '');
      if (!id) continue;
      const c = count.get(id);
      if (c) c.n++; else count.set(id, { meal: m, n: 1 });
    }
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n).slice(0, PANTRY_TOP);
  const full = await Promise.allSettled(top.map(c => meals(`lookup.php?i=${encodeURIComponent(String(c.meal.idMeal))}`)));
  // every full recipe failed to load (the network dropped after the ingredient lists were kept): say so, not "no recipes"
  if (top.length && full.every(f => f.status === 'rejected')) return { status: 'error', recipes: [], error: errorText((full[0] as PromiseRejectedResult).reason) };
  const list: { recipe: Recipe; matched: number }[] = [];
  full.forEach((f, k) => {
    if (f.status !== 'fulfilled') return;
    const [recipe] = mapMeals(f.value, 1);
    if (recipe) list.push({ recipe, matched: top[k].n });
  });
  return { status: 'ok', recipes: rankPantry(list, p.have, p.want) };
}

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'search', handle: ({ query }) => search(query.get('q') || '') },
    { method: 'GET', path: 'random', handle: () => random() },
    { method: 'GET', path: 'ingredients', handle: () => ingredients() },
    { method: 'GET', path: 'pantry', handle: ({ query }) => pantry(query.get('have') || '', query.get('want') || '') },
  ],
};
export default app;

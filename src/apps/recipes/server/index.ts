// Recipes app routes (under /api/recipes/). The page asks the hub, so the browser never calls TheMealDB itself.
// TheMealDB is free and needs no account (its public test key "1" is part of the address).
//   GET search?q=…   meals whose name matches q; an empty q gives the random meals
//   GET random       up to 8 random meals (kept for 30 minutes)
import type { ServerApp } from '../../../core/server/app.ts';
import type { MealsResult } from '../api.ts';
import { manifest } from '../manifest.ts';
import { mapMeals } from '../web/mealdb.ts';
import type { Recipe } from '../web/recipe.ts';

const API = 'https://www.themealdb.com/api/json/v1/1';
const RANDOM_COUNT = 8;
const RANDOM_KEEP_MS = 30 * 60e3;

let randomCache: { at: number; recipes: Recipe[] } | null = null;

async function meals(path: string): Promise<unknown[]> {
  const r = await fetch(`${API}/${path}`, { headers: { 'User-Agent': 'ClaudeOS-Recipes', Accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body: any = await r.json();
  return Array.isArray(body?.meals) ? body.meals : [];
}

const failed = (e: unknown): MealsResult => ({ status: 'error', recipes: [], error: String((e as Error)?.message ?? e).slice(0, 120) });

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

const app: ServerApp = {
  id: manifest.id,
  routes: [
    { method: 'GET', path: 'search', handle: ({ query }) => search(query.get('q') || '') },
    { method: 'GET', path: 'random', handle: () => random() },
  ],
};
export default app;

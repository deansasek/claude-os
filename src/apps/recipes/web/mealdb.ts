// TheMealDB (themealdb.com, free public API, no key) to the Recipes app's recipe shape. Pure functions, shared by the
// hub route (recipes/server/index.ts) and the page. Tested in test/recipes-mealdb.test.ts.
import { fromStored, type Recipe } from './recipe.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** The sentences of one long paragraph, each a step. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/).map(s => s.trim()).filter(Boolean);
}

/** The steps in TheMealDB's instructions text: one per line, with "STEP 1" and "1." markers removed. A text with one
 *  paragraph, or a line too long for one step, is split into sentences. */
export function splitSteps(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:step\s*\d+\s*[:.)-]?|\d+\s*[.)](?!\d)|[•*▢-])\s*/i, '').replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^(?:step\s*)?\d+[.:)]?$/i.test(l));
  return lines.flatMap(l => (lines.length === 1 || l.length > 300 ? sentences(l) : [l]));
}

/** One TheMealDB meal as a recipe, or null when it has no name or no steps. TheMealDB gives no serves or time. */
export function mapMeal(m: any): Recipe | null {
  if (!m || typeof m !== 'object') return null;
  const ingredients: { amount: string; item: string }[] = [];
  for (let k = 1; k <= 20; k++) {
    const item = str(m[`strIngredient${k}`]);
    if (item) ingredients.push({ amount: str(m[`strMeasure${k}`]), item });
  }
  const area = str(m.strArea), category = str(m.strCategory);
  return fromStored({
    name: m.strMeal,
    serves: '',
    time: '',
    ingredients,
    steps: splitSteps(m.strInstructions),
    image: str(m.strMealThumb),
    mealId: str(m.idMeal),
    tag: [area === 'Unknown' ? '' : area, category].filter(Boolean).join(' · '),
  });
}

/** A list of meals as recipes: invalid ones dropped, each TheMealDB id once, at most `max`. */
export function mapMeals(list: unknown, max = 24): Recipe[] {
  const out: Recipe[] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(list) ? list : []) {
    const r = mapMeal(m);
    if (!r || (r.mealId && seen.has(r.mealId))) continue;
    if (r.mealId) seen.add(r.mealId);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

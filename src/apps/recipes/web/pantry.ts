// Recipes: "What do you have". The picker's names, the staples that never count as missing, and the ranking of
// recipes by what the cook lacks. Pure functions, shared by the hub route (recipes/server/index.ts) and the page.
// Tested in test/recipes-pantry.test.ts.
import type { Recipe } from './recipe.ts';

export const PANTRY_MAX = 8;    // the names the picker holds: "have" and "want" together
export const PANTRY_TOP = 12;   // the meals fetched in full, by how many "have" names they match
export const STAPLES = ['salt', 'pepper', 'black pepper', 'water', 'oil', 'olive oil', 'vegetable oil'];

/** A recipe with the ingredients the cook lacks (missing) and how many "have" names it uses (matched). */
export interface PantryRecipe extends Recipe { missing: string[]; matched: number }

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The "have" and "want" names from comma-separated text: trimmed, lower-cased, de-duplicated. A name in both lists is "have".
 *  More than PANTRY_MAX names is an error. */
export function parsePantry(haveText: string, wantText: string): { ok: true; have: string[]; want: string[] } | { ok: false; error: string } {
  const split = (t: string): string[] => [...new Set(t.split(',').map(s => norm(s).slice(0, 40)).filter(Boolean))];
  const have = split(haveText);
  const want = split(wantText).filter(n => !have.includes(n));
  if (have.length + want.length > PANTRY_MAX) return { ok: false, error: `Pick at most ${PANTRY_MAX} ingredients.` };
  return { ok: true, have, want };
}

/** The ingredient names the cook lacks: not "have", not "want", not a staple. Each name once, in the recipe's order. */
export function missingFor(r: Recipe, have: string[], want: string[]): string[] {
  const known = new Set([...have, ...want, ...STAPLES].map(norm));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of r.ingredients) {
    const n = norm(i.item);
    if (!n || known.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(i.item.trim());
  }
  return out;
}

/** Recipes sorted by missing names (fewest first), then by "have" names used (most first), then by name. */
export function rankPantry(list: { recipe: Recipe; matched: number }[], have: string[], want: string[]): PantryRecipe[] {
  return list
    .map(({ recipe, matched }) => ({ ...recipe, matched, missing: missingFor(recipe, have, want) }))
    .sort((a, b) => a.missing.length - b.missing.length || b.matched - a.matched || a.name.localeCompare(b.name));
}

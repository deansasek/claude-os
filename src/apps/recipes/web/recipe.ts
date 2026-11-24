// Recipes: the recipe shape, the fixed prompt for Claude, reading a recipe out of Claude's reply, and the text of one
// cook-mode step. Pure functions: no DOM, no store. Tested in test/recipes.test.ts.

export interface Ingredient { amount: string; item: string }

export interface Recipe {
  name: string;
  serves: string;          // "4", "4 people"; empty when unknown
  time: string;            // "40 min"; empty when unknown
  ingredients: Ingredient[];
  steps: string[];
}

/** The fixed request sent to the tablet's Claude chat. It carries no private data. */
export const RECIPE_PROMPT = [
  'Give me one recipe. Reply with the recipe as JSON only, in one code block, with exactly these keys:',
  '"name" (text), "serves" (how many people), "time" (total time, like "40 min"),',
  '"ingredients" (a list of objects, each with "amount" and "item"), and "steps" (a list of short text steps, in order).',
  'Write no other text.',
].join(' ');

/** The JSON value in a reply: a fenced code block first, else the text from the first "{" to the last "}". */
export function extractJson(reply: string): unknown {
  const candidates: string[] = [];
  const fence = reply.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  const start = reply.indexOf('{'), end = reply.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(reply.slice(start, end + 1));
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch { /* try the next candidate */ }
  }
  return undefined;
}

const clean = (v: unknown, max: number): string => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
};

/** A parsed JSON value as a recipe, or null when it has no name or no steps. */
export function toRecipe(v: any): Recipe | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const name = clean(v.name, 80);
  const steps = (Array.isArray(v.steps) ? v.steps : [])
    .map((s: any) => clean(s && typeof s === 'object' ? (s.text ?? s.step) : s, 400))
    .filter(Boolean)
    .slice(0, 60);
  if (!name || steps.length === 0) return null;
  const ingredients: Ingredient[] = (Array.isArray(v.ingredients) ? v.ingredients : []).flatMap((i: any): Ingredient[] => {
    if (typeof i === 'string') {
      const item = clean(i, 120);
      return item ? [{ amount: '', item }] : [];
    }
    if (i && typeof i === 'object') {
      const item = clean(i.item ?? i.name ?? i.ingredient, 120);
      return item ? [{ amount: clean(i.amount ?? i.quantity, 40), item }] : [];
    }
    return [];
  }).slice(0, 80);
  return { name, serves: clean(v.serves, 20), time: clean(v.time, 40), ingredients, steps };
}

export type Parsed = { ok: true; recipe: Recipe } | { ok: false };

/** Reads a recipe from Claude's reply. Code fences and text around the JSON are tolerated. */
export function parseRecipe(reply: string): Parsed {
  const recipe = toRecipe(extractJson(reply));
  return recipe ? { ok: true, recipe } : { ok: false };
}

/** A reply that is not a recipe, saved as it is: the first line is the name, the whole text is one step. */
export function textRecipe(reply: string): Recipe {
  const first = reply.split('\n').map(l => l.replace(/^[#*\s>-]+/, '').trim()).find(Boolean) ?? '';
  return {
    name: first.slice(0, 60) || 'Saved reply',
    serves: '',
    time: '',
    ingredients: [],
    steps: [reply.trim().slice(0, 4000) || 'No text.'],
  };
}

/** The text of one cook-mode step. The step number is clamped to the recipe's steps. */
export function cookStep(r: Recipe, i: number): { heading: string; text: string; index: number; first: boolean; last: boolean } {
  const total = r.steps.length;
  const index = Math.min(Math.max(0, Math.floor(i) || 0), total - 1);
  return { heading: `Step ${index + 1} of ${total}`, text: r.steps[index], index, first: index === 0, last: index === total - 1 };
}
